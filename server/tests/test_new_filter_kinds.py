"""Unit tests for percentile alphanumeric, biotypeFamily, resource, presets."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = SERVER_DIR.parent / "scripts"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


class NewFilterKindsTest(unittest.TestCase):
    def test_normalize_and_scopes(self) -> None:
        from beacon.filters import axis_filter_scope, normalize_filters

        filters = normalize_filters(
            [
                {
                    "id": "expression.percentile",
                    "operator": ">=",
                    "value": "99",
                },
                {
                    "id": "feature.biotypeFamily",
                    "operator": "=",
                    "value": "lncRNA",
                },
                {
                    "id": "feature.resource",
                    "operator": "=",
                    "value": "GenCode",
                },
                {"id": "biosample.preset:female+UBERON:0002048"},
            ]
        )
        self.assertEqual(
            [f.kind for f in filters],
            [
                "alphanumeric",
                "alphanumeric",
                "alphanumeric",
                "custom",
            ],
        )
        self.assertEqual(
            [axis_filter_scope(f) for f in filters],
            ["feature", "feature", "feature", "biosample"],
        )

    def test_percentile_not_matrix_only(self) -> None:
        from beacon.filters import is_matrix_only_expression_filter, normalize_filters

        pct = normalize_filters(
            [{"id": "expression.percentile", "operator": ">=", "value": "90"}]
        )[0]
        median = normalize_filters(
            [{"id": "expression.median", "operator": ">=", "value": "1"}]
        )[0]
        self.assertFalse(is_matrix_only_expression_filter(pct))
        self.assertTrue(is_matrix_only_expression_filter(median))

    def test_feature_doc_matches_expression_biotype_resource(self) -> None:
        from beacon.filters import feature_doc_matches, normalize_filters

        doc = {
            "featureIdentifier": {"id": "ENSG1", "resource": "gencode"},
                "featureType": {"id": "SO:0001217"},
                "ontologyTerms": [{"id": "SO:0002127"}],
            "info": {
                "median_percentile": 99.2,
            },
        }
        pct_99 = normalize_filters(
            [{"id": "expression.percentile", "operator": ">=", "value": "99"}]
        )
        pct_90 = normalize_filters(
            [{"id": "expression.percentile", "operator": ">=", "value": "90"}]
        )
        pct_miss = {
            **doc,
            "info": {"median_percentile": 40.0},
        }
        pc = normalize_filters(
            [
                {
                    "id": "feature.biotypeFamily",
                    "operator": "=",
                    "value": "protein_coding",
                }
            ]
        )
        lnc = normalize_filters(
            [{"id": "feature.biotypeFamily", "operator": "=", "value": "lncRNA"}]
        )
        gencode = normalize_filters(
            [{"id": "feature.resource", "operator": "=", "value": "GenCode"}]
        )
        ncbi = normalize_filters(
            [{"id": "feature.resource", "operator": "=", "value": "NCBI Gene"}]
        )

        self.assertTrue(feature_doc_matches(doc, pct_99))
        self.assertTrue(feature_doc_matches(doc, pct_90))
        self.assertFalse(feature_doc_matches(pct_miss, pct_99))
        self.assertTrue(feature_doc_matches(doc, pc))
        self.assertTrue(feature_doc_matches(doc, lnc))
        self.assertTrue(feature_doc_matches(doc, gencode))
        self.assertFalse(feature_doc_matches(doc, ncbi))

        gene_only = {
            "featureIdentifier": {"id": "ENSG2", "resource": "gencode"},
                "featureType": {"id": "SO:0000704"},
                "ontologyTerms": [{"id": "SO:0002127"}],
        }
        self.assertFalse(feature_doc_matches(gene_only, pc))
        self.assertTrue(feature_doc_matches(gene_only, lnc))

        pc_via_ontology = {
            "featureIdentifier": {"id": "ENSG3", "resource": "gencode"},
                "featureType": {"id": "SO:0000704"},
                "ontologyTerms": [{"id": "SO:0001217"}],
        }
        self.assertTrue(feature_doc_matches(pc_via_ontology, pc))

        pc_via_biotype = {
            "featureIdentifier": {"id": "ENSG4", "resource": "gencode"},
            "featureType": {"id": "SO:0000704"},
            "biotype": {"id": "SO:0001217", "label": "protein_coding_gene"},
            "ontologyTerms": [{"id": "GO:0008150"}],
        }
        self.assertTrue(feature_doc_matches(pc_via_biotype, pc))
        self.assertFalse(feature_doc_matches(pc_via_biotype, lnc))

        so_biotype = normalize_filters([{"id": "SO:0001217"}])
        so_go = normalize_filters([{"id": "GO:0008150"}])
        self.assertTrue(feature_doc_matches(pc_via_biotype, so_biotype))
        self.assertTrue(feature_doc_matches(pc_via_biotype, so_go))
        self.assertFalse(
            feature_doc_matches(
                {
                    "featureIdentifier": {"id": "ENSG5", "resource": "gencode"},
                    "featureType": {"id": "SO:0000704"},
                    "ontologyTerms": [{"id": "GO:0008150"}],
                },
                so_biotype,
            )
        )

    def test_feature_doc_matches_symbol_case_sensitive(self) -> None:
        from beacon.filters import feature_doc_matches, normalize_filters

        doc = {
            "featureIdentifier": {"id": "ENSG_ALB", "resource": "gencode"},
                "aliases": ["ALB", "HSA"],
        }
        alb_upper = normalize_filters([{"id": "symbol:ALB"}])
        alb_title = normalize_filters([{"id": "symbol:Alb"}])
        alb_lower = normalize_filters([{"id": "symbol:alb"}])
        self.assertTrue(feature_doc_matches(doc, alb_upper))
        self.assertFalse(feature_doc_matches(doc, alb_title))
        self.assertFalse(feature_doc_matches(doc, alb_lower))

        doc_title = {
            "featureIdentifier": {"id": "ENSG_Alb", "resource": "gencode"},
                "aliases": ["Alb"],
        }
        self.assertTrue(feature_doc_matches(doc_title, alb_title))
        self.assertFalse(feature_doc_matches(doc_title, alb_upper))

    def test_unsupported_biosample_filters_rejected(self) -> None:
        from beacon.filters import biosample_matches, normalize_filters, validate_filters_for_entity

        preset = normalize_filters(
            [{"id": "biosample.preset:female+UBERON:0002048"}]
        )
        self.assertIsNotNone(
            validate_filters_for_entity(preset, entity="biosample")
        )

        sex = normalize_filters(
            [{"id": "sex", "operator": "=", "value": "female"}]
        )
        self.assertIsNotNone(validate_filters_for_entity(sex, entity="biosample"))

        doc = {
            "phenotypicFeatures": [{"featureType": {"id": "UBERON:0002048"}}],
        }
        self.assertFalse(biosample_matches(doc, preset))
        self.assertFalse(biosample_matches(doc, sex))

    def test_validate_rejects_bad_values(self) -> None:
        from beacon.filters import normalize_filters, validate_filters_for_entity

        bad_dropped = normalize_filters([{"id": "expression.profile:ubiquitous"}])
        err = validate_filters_for_entity(bad_dropped, entity="feature")
        self.assertIsNotNone(err)

        # Old custom percentile ids are rejected (no deprecation path).
        old_custom = normalize_filters([{"id": "expression.percentile:>=90%"}])
        err = validate_filters_for_entity(old_custom, entity="feature")
        self.assertIsNotNone(err)

        bad_detected = normalize_filters([{"id": "expression.detected:>=90%"}])
        err = validate_filters_for_entity(bad_detected, entity="feature")
        self.assertIsNotNone(err)

        bad_fam = normalize_filters(
            [{"id": "feature.biotypeFamily", "operator": "=", "value": "mRNA"}]
        )
        err = validate_filters_for_entity(bad_fam, entity="feature")
        self.assertIsNotNone(err)

        bad_preset = normalize_filters([{"id": "biosample.preset:onlysex"}])
        err = validate_filters_for_entity(bad_preset, entity="biosample")
        self.assertIsNotNone(err)

    def test_friendly_labels(self) -> None:
        from beacon.filter_display import (
            expression_percentile_label,
            so_display_label,
        )

        self.assertEqual(
            so_display_label("processed_pseudogene"), "Processed Pseudogene"
        )
        self.assertEqual(expression_percentile_label(), "Top expressed")
        self.assertEqual(
            expression_percentile_label(matrix_scoped=True),
            "Top expressed (this matrix)",
        )

    def test_so_0000704_not_in_protein_coding_family(self) -> None:
        from beacon.biotype_families import (
            family_for_so_id,
            feature_matches_biotype_family,
            so_ids_for_family,
        )

        self.assertNotIn("SO:0000704", so_ids_for_family("protein_coding"))
        self.assertIsNone(family_for_so_id("SO:0000704"))
        self.assertFalse(
            feature_matches_biotype_family(
                "protein_coding",
                feature_type_id="SO:0000704",
                ontology_term_ids=[],
            )
        )


if __name__ == "__main__":
    unittest.main()
