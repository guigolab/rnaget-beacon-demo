"""Unit tests for tissueTop / tissuePresent filtering_terms catalog helpers."""

from __future__ import annotations

import unittest

from beacon.tissue_explore_catalog import build_tissue_explore_filtering_terms


class TissueExploreCatalogTest(unittest.TestCase):
    def test_emits_top_and_present_for_uberon(self) -> None:
        terms = build_tissue_explore_filtering_terms(
            [
                {
                    "ontology_id": "UBERON:0002107",
                    "label": "liver",
                    "n_biosamples": 235,
                }
            ]
        )
        by_id = {t["id"]: t for t in terms}
        self.assertEqual(
            set(by_id),
            {"tissueTop:UBERON:0002107", "tissuePresent:UBERON:0002107"},
        )
        top = by_id["tissueTop:UBERON:0002107"]
        self.assertEqual(top["type"], "custom")
        self.assertEqual(top["scopes"], ["genomicFeature"])
        self.assertIn("Top 1%", top["label"])
        self.assertIn("liver", top["label"])
        self.assertIn("235", top["label"])
        present = by_id["tissuePresent:UBERON:0002107"]
        self.assertIn("Present in", present["label"])

    def test_skips_matrix_pseudo_and_non_catalog_oids(self) -> None:
        terms = build_tissue_explore_filtering_terms(
            [
                {"ontology_id": "matrix:GSE107011", "n_biosamples": 10},
                {"ontology_id": "NCIT:C123", "label": "other"},
                {"ontology_id": "EFO:0004167", "label": "cell type", "n_biosamples": 3},
            ]
        )
        ids = {t["id"] for t in terms}
        self.assertEqual(
            ids,
            {"tissueTop:EFO:0004167", "tissuePresent:EFO:0004167"},
        )

    def test_dedupes_ontology_ids(self) -> None:
        terms = build_tissue_explore_filtering_terms(
            [
                {"ontology_id": "UBERON:0000955", "label": "brain", "n_biosamples": 1},
                {"ontology_id": "UBERON:0000955", "label": "brain", "n_biosamples": 99},
            ]
        )
        self.assertEqual(len(terms), 2)


if __name__ == "__main__":
    unittest.main()
