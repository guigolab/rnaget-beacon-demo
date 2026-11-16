"""Wide-table fast path returns exactly what the summary query returns."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from beacon.filters import normalize_filters

DEMO_PACKAGE = Path(
    os.environ.get(
        "RNAGET_BUILT_PACKAGE",
        str(Path(__file__).resolve().parents[2] / "data" / "rnaget-demo"),
    )
)
HAS_WIDE = (DEMO_PACKAGE / "tissue_percentile_wide.parquet").is_file()


def _filters(oid: str, op: str, value: str):
    return normalize_filters(
        [{"id": f"tissue.percentile:{oid}", "operator": op, "value": value}]
    )


@unittest.skipUnless(HAS_WIDE, "built package with tissue_percentile_wide.parquet required")
class TissueWideEquivalenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        from beacon.duckdb_store import DuckDBStore

        cls.fast = DuckDBStore(DEMO_PACKAGE)
        cls.slow = DuckDBStore(DEMO_PACKAGE)
        # Disable the fast path on the reference store.
        cls.slow._tissue_wide_view = None
        assert cls.fast._tissue_wide_view, "wide view not loaded"

    def test_same_rows_order_and_total(self) -> None:
        oids = sorted(self.fast._tissue_wide_ontologies)
        self.assertTrue(oids)
        for oid in oids:
            for op, value in ((">=", "99"), (">=", "90"), (">=", "0"), (">", "95")):
                for skip, limit in ((0, 25), (7, 10), (0, 1000), (10_000_000, 5)):
                    filters = _filters(oid, op, value)
                    got, got_total = self.fast.list_features_page(
                        skip=skip, limit=limit, filters=filters
                    )
                    want, want_total = self.slow.list_features_page(
                        skip=skip, limit=limit, filters=filters
                    )
                    ctx = (oid, op, value, skip, limit)
                    self.assertEqual(got_total, want_total, ctx)
                    self.assertEqual(
                        [d.get("id") for d in got], [d.get("id") for d in want], ctx
                    )

    def test_gene_filter_plus_tissue_matches_summary(self) -> None:
        """symbol / resource / SO filters AND a tissue term: same rows as the SQL join."""
        oids = sorted(self.fast._tissue_wide_ontologies)[:4]
        gene_filters = [
            [{"id": "symbol", "operator": "=", "value": "ALB"}],
            [{"id": "symbol", "operator": "=", "value": "ENSG00000163631.16"},
             {"id": "feature.resource", "operator": "=", "value": "GenCode"}],
            [{"id": "symbol", "operator": "=", "value": "213"},
             {"id": "feature.resource", "operator": "=", "value": "NCBI Gene"}],
            [{"id": "SO:0001217"}],  # protein coding: too many candidates -> SQL fallback
        ]
        for gene in gene_filters:
            for oid in oids:
                tissue = [{"id": f"tissue.percentile:{oid}", "operator": ">=", "value": "99"}]
                filters = normalize_filters(gene + tissue)
                for limit in (0, 5, 1000):
                    got, got_total = self.fast.list_features_page(
                        skip=0, limit=limit, filters=filters
                    )
                    want, want_total = self.slow.list_features_page(
                        skip=0, limit=limit, filters=filters
                    )
                    ctx = (gene, oid, limit)
                    self.assertEqual(got_total, want_total, ctx)
                    self.assertEqual(
                        [d.get("id") for d in got], [d.get("id") for d in want], ctx
                    )

    def test_per_feature_boolean_is_exact(self) -> None:
        """symbol = <feature id> + resource + tissue term answers for that one gene row.

        Covers symbol-less genes (need gene_lookup completion), the numeric id
        that collides with another gene's alias, and a random sample.
        """
        import random

        store = self.fast
        rows, _ = store._fetchall(
            "SELECT feature_id, resource, wrapper_id, symbol FROM feature_index"
        )
        by_kind = {
            "symbol-less": [r for r in rows if r[3] is None],
            "numeric": [r for r in rows if str(r[0]).isdigit()],
        }
        rng = random.Random(7)
        sample = (
            rng.sample(by_kind["symbol-less"], min(40, len(by_kind["symbol-less"])))
            + [r for r in by_kind["numeric"] if r[0] == "1"]
            + rng.sample(rows, 300)
        )
        oids = sorted(store._tissue_wide_ontologies)[:3]
        for feature_id, resource, wrapper_id, _sym in sample:
            for oid in oids:
                col = '"' + oid + '"'
                pct = store._fetchone(
                    f"SELECT {col} FROM tissue_percentile_wide WHERE wrapper_id = ?",
                    [wrapper_id],
                )
                want = bool(pct and pct[0] is not None and pct[0] >= 99)
                filters = normalize_filters(
                    [
                        {"id": "symbol", "operator": "=", "value": feature_id},
                        {"id": "feature.resource", "operator": "=", "value": resource},
                        {"id": f"tissue.percentile:{oid}", "operator": ">=", "value": "99"},
                    ]
                )
                _docs, total = store.list_features_page(skip=0, limit=0, filters=filters)
                self.assertEqual(total > 0, want, (feature_id, resource, oid, total))
                self.assertLessEqual(total, 1, (feature_id, resource, oid))

    def test_two_tissue_terms_and(self) -> None:
        a, b = sorted(self.fast._tissue_wide_ontologies)[:2]
        filters = normalize_filters(
            [
                {"id": f"tissue.percentile:{a}", "operator": ">=", "value": "95"},
                {"id": f"tissue.percentile:{b}", "operator": ">=", "value": "90"},
            ]
        )
        got, got_total = self.fast.list_features_page(skip=0, limit=50, filters=filters)
        want, want_total = self.slow.list_features_page(skip=0, limit=50, filters=filters)
        self.assertEqual(got_total, want_total)
        self.assertEqual([d.get("id") for d in got], [d.get("id") for d in want])

    def test_count_only(self) -> None:
        oid = sorted(self.fast._tissue_wide_ontologies)[0]
        filters = _filters(oid, ">=", "99")
        docs, total = self.fast.list_features_page(skip=0, limit=0, filters=filters)
        _, want_total = self.slow.list_features_page(skip=0, limit=0, filters=filters)
        self.assertEqual(docs, [])
        self.assertEqual(total, want_total)

    def test_other_operators_use_summary(self) -> None:
        oid = sorted(self.fast._tissue_wide_ontologies)[0]
        for op in ("<=", "<", "="):
            filters = _filters(oid, op, "50")
            self.assertIsNone(self.fast._tissue_wide_threshold(filters[0]))


if __name__ == "__main__":
    unittest.main()
