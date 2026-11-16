"""Precomputed head + threshold top-N return exactly what the full query returns."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

DEMO_PACKAGE = Path(
    os.environ.get(
        "RNAGET_BUILT_PACKAGE",
        str(Path(__file__).resolve().parents[2] / "data" / "rnaget-demo"),
    )
)
HAS_TOP = (DEMO_PACKAGE / "expression_top_cells.parquet").is_file()
MATRICES = ["GSE107011", "GTEx-v8-Liver", "ENCSR622FSM"]


def _walk(store, matrix, order, pages, limit=1000, **kw):
    out, token = [], None
    for _ in range(pages):
        page = store.expression_values_for_matrix(
            matrix, order=order, limit=limit, page_token=token, **kw
        )
        out.append(([(r["featureId"], r["biosampleId"], r["value"]) for r in page.results], page.total, page.next_page))
        token = page.next_page
        if not token:
            break
    return out


@unittest.skipUnless(HAS_TOP, "built package with expression_top_cells.parquet required")
class TopCellsEquivalenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        from beacon.duckdb_store import DuckDBStore

        cls.fast = DuckDBStore(DEMO_PACKAGE)
        cls.slow = DuckDBStore(DEMO_PACKAGE)
        cls.slow._top_cells_table = None
        assert cls.fast._top_cells_table, "top cells not loaded"

    def _same(self, matrix, order, pages, **kw):
        fast = _walk(self.fast, matrix, order, pages, **kw)
        # Reference: no head table and no threshold pre-query.
        with mock.patch("beacon.duckdb_store.TOP_N_THRESHOLD_MIN_ROWS", 10**15):
            slow = _walk(self.slow, matrix, order, pages, **kw)
        self.assertEqual([p[0] for p in fast], [p[0] for p in slow])
        self.assertEqual([p[1] for p in fast], [p[1] for p in slow])
        # Page tokens are a function of the last row: identical walks agree.
        self.assertEqual([p[2] for p in fast], [p[2] for p in slow])

    def test_pages_across_the_stored_depth(self) -> None:
        # 7 pages of 1000 crosses the 5000-row head into the full query.
        for matrix in MATRICES:
            for order in ("desc", "asc"):
                with self.subTest(matrix=matrix, order=order):
                    self._same(matrix, order, 7)

    def test_skip_and_small_limits(self) -> None:
        for order in ("desc", "asc"):
            for skip, limit in ((0, 1), (0, 37), (123, 500), (4900, 200)):
                with self.subTest(order=order, skip=skip, limit=limit):
                    a = self.fast.expression_values_for_matrix(
                        "GTEx-v8-Liver", order=order, skip=skip, limit=limit
                    )
                    with mock.patch("beacon.duckdb_store.TOP_N_THRESHOLD_MIN_ROWS", 10**15):
                        b = self.slow.expression_values_for_matrix(
                            "GTEx-v8-Liver", order=order, skip=skip, limit=limit
                        )
                    self.assertEqual(a.results, b.results)
                    self.assertEqual(a.total, b.total)

    def test_filtered_queries_use_threshold_not_head(self) -> None:
        feats = ",".join(
            r["featureId"]
            for r in self.slow.expression_values_for_matrix(
                "GTEx-v8-Liver", order="desc", limit=200
            ).results[:5]
        )
        for order in ("desc", "asc"):
            with self.subTest(order=order):
                self._same("GTEx-v8-Liver", order, 3, feature_id_list=feats)
                self._same("GTEx-v8-Liver", order, 3, min_value=50.0)


if __name__ == "__main__":
    unittest.main()
