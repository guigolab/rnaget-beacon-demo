"""Unit tests for expression catalog support scan + matrix subsetting."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))


class ExpressionCatalogSupportTest(unittest.TestCase):
    def test_percentile_thresholds_only(self) -> None:
        import pyarrow as pa
        import pyarrow.parquet as pq

        from beacon.expression_catalog_support import (
            MatrixExpressionCatalogSupport,
            merge_expression_support,
            scan_matrix_expression_support,
            top_sex_tissue_presets,
        )

        with tempfile.TemporaryDirectory() as tmp:
            matrix_dir = Path(tmp)
            pq.write_table(
                pa.table(
                    {
                        "feature_id": ["a", "b", "c", "d"],
                        "detected_fraction": [0.1, 0.95, 0.5, 0.0],
                        "median_percentile": [12.0, 99.5, 96.0, None],
                    }
                ),
                matrix_dir / "feature_expression_stats.parquet",
            )
            pq.write_table(
                pa.table(
                    {
                        "biosample_id": ["s1", "s2", "s3", "s4"],
                        "sex": ["female", "female", "male", "female"],
                        "ontology_id": [
                            "UBERON:0002048",
                            "UBERON:0002048",
                            "UBERON:0000178",
                            "UBERON:0000178",
                        ],
                        "ontology_label": ["lung", "lung", "blood", "blood"],
                    }
                ),
                matrix_dir / "biosamples.parquet",
            )

            support = scan_matrix_expression_support(matrix_dir)
            self.assertEqual(support.percentile_thresholds, {90, 95, 99})
            self.assertEqual(
                support.ordered_percentile_thresholds(), [99, 95, 90]
            )
            self.assertEqual(
                support.percentile_catalog_values(), ["90", "95", "99"]
            )

            ids = support.categorical_expression_ids()
            self.assertEqual(ids, {"expression.percentile"})
            self.assertNotIn("expression.percentile:>=90%", ids)
            self.assertNotIn("expression.profile:tissue-enriched", ids)
            self.assertNotIn("expression.detected:>=90%", ids)

            ranked = top_sex_tissue_presets(support.sex_tissue_presets, cap=2)
            self.assertEqual(ranked[0][0], ("female", "UBERON:0002048"))
            self.assertEqual(ranked[0][1][2], 2)

            other = MatrixExpressionCatalogSupport(percentile_thresholds={90})
            merged = merge_expression_support([support, other])
            self.assertEqual(merged.percentile_thresholds, {90, 95, 99})

    def test_subset_terms_expression_and_preset_gates(self) -> None:
        from beacon.matrix_axis_catalog import _subset_terms

        global_terms = [
            {
                "type": "custom",
                "id": "expression.percentile",
                "scopes": ["genomicFeature"],
                "values": ["90", "95", "99"],
            },
            {
                "type": "custom",
                "id": "expression.profile:tissue-enriched",
                "scopes": ["genomicFeature"],
            },
            {
                "type": "alphanumeric",
                "id": "expression.median",
                "scopes": ["genomicFeature"],
            },
            {
                "type": "custom",
                "id": "biosample.preset:female+UBERON:0002048",
                "scopes": ["biosample"],
            },
            {
                "type": "custom",
                "id": "biosample.preset:male+UBERON:0002048",
                "scopes": ["biosample"],
            },
        ]
        resources: list = []

        feat_terms, _ = _subset_terms(
            global_terms,
            resources,
            present_ids=set(),
            alphanumeric={},
            scope="genomicFeature",
            allowed_expression_ids=None,
        )
        feat_ids = {t["id"] for t in feat_terms}
        self.assertNotIn("expression.percentile", feat_ids)
        self.assertIn("expression.median", feat_ids)

        allowed = {"expression.percentile"}
        feat_terms, _ = _subset_terms(
            global_terms,
            resources,
            present_ids=set(),
            alphanumeric={"expression.percentile": {"90", "95"}},
            scope="genomicFeature",
            allowed_expression_ids=allowed,
        )
        feat_ids = {t["id"] for t in feat_terms}
        self.assertEqual(
            feat_ids,
            {
                "expression.percentile",
                "expression.median",
            },
        )
        pct = next(t for t in feat_terms if t["id"] == "expression.percentile")
        self.assertEqual(pct["values"], ["90", "95"])

        bio_terms, _ = _subset_terms(
            global_terms,
            resources,
            present_ids={"UBERON:0002048"},
            alphanumeric={"sex": {"female", "male"}},
            scope="biosample",
            sex_ontology_pairs={("female", "UBERON:0002048")},
        )
        bio_ids = {t["id"] for t in bio_terms}
        # Presets are matchable via API but never subset into catalogs.
        self.assertNotIn("biosample.preset:female+UBERON:0002048", bio_ids)
        self.assertNotIn("biosample.preset:male+UBERON:0002048", bio_ids)


if __name__ == "__main__":
    unittest.main()
