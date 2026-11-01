"""Tests for matrix filters, summaries, and symbol resolution."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

os.environ.pop("DATA_PACKAGE_PATH", None)


class ApiExtensionsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import beacon.fixtures.store as st

        st._STORE = None
        from fastapi.testclient import TestClient
        from app import app

        cls.client = TestClient(app)

    def test_matrices_filtering_terms_non_empty(self) -> None:
        r = self.client.get("/matrices/filtering_terms")
        self.assertEqual(r.status_code, 200)
        terms = r.json()["response"]["filteringTerms"]
        self.assertTrue(any(t["id"] == "matrix.unit" for t in terms))
        self.assertTrue(any(t.get("type") == "OBI" for t in terms))
        self.assertTrue(any(t.get("type") == "SO" for t in terms))

    def test_matrix_unit_filter(self) -> None:
        r = self.client.post(
            "/matrices",
            json={
                "query": {
                    "filters": [
                        {"id": "matrix.unit", "operator": "=", "value": "TPM"}
                    ],
                    "pagination": {"skip": 0, "limit": 10},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)

    def test_matrix_obi_filter(self) -> None:
        r = self.client.post(
            "/matrices",
            json={
                "query": {
                    "filters": [{"id": "OBI:0003090"}],
                    "pagination": {"skip": 0, "limit": 10},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        results = r.json()["response"]["resultSets"][0]["results"]
        self.assertTrue(len(results) >= 1)

    def test_expression_summary_by_symbol_get(self) -> None:
        r = self.client.get(
            "/matrices/matrix-gene-expression-001/expression_summary",
            params={"featureIDList": "TP53", "requestedGranularity": "record"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["responseSummary"]["exists"])

    def test_expression_summary_request_parameters_post(self) -> None:
        r = self.client.post(
            "/matrices/matrix-gene-expression-001/expression_summary",
            json={
                "query": {
                    "requestedGranularity": "record",
                    "requestParameters": {"featureIDList": "TP53"},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["responseSummary"]["exists"])

    def test_legacy_top_level_feature_id_list_rejected(self) -> None:
        r = self.client.post(
            "/matrices/matrix-gene-expression-001/expression_values",
            json={
                "query": {"pagination": {"skip": 0, "limit": 5}},
                "featureIDList": "TP53",
            },
        )
        self.assertEqual(r.status_code, 400, r.text)

    def test_empty_cohort_filter_returns_no_expression(self) -> None:
        r = self.client.post(
            "/matrices/matrix-gene-expression-001/expression_values",
            json={
                "query": {
                    "filters": [
                        {
                            "id": "condition",
                            "operator": "=",
                            "value": "__no_such_condition__",
                        }
                    ],
                    "pagination": {"skip": 0, "limit": 5},
                    "requestParameters": {"featureIDList": "TP53"},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["responseSummary"]["numTotalResults"], 0)

    def test_unknown_matrix_id_empty_200(self) -> None:
        r = self.client.get(
            "/matrices/__no_such_matrix__",
            params={"requestedGranularity": "boolean"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertFalse(r.json()["responseSummary"]["exists"])

    def test_service_info(self) -> None:
        r = self.client.get("/service-info")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()["response"]
        self.assertIn("type", body)

    def test_feature_expression_summary(self) -> None:
        feats = self.client.post(
            "/features",
            json={
                "query": {
                    "filters": [
                        {
                            "id": "genomicFeature.symbol",
                            "operator": "=",
                            "value": "TP53",
                        }
                    ],
                    "pagination": {"skip": 0, "limit": 1},
                }
            },
        ).json()
        fid = feats["response"]["resultSets"][0]["results"][0]["id"]
        r = self.client.get(f"/features/{fid}/expression_summary")
        self.assertEqual(r.status_code, 200, r.text)

    def test_biosample_status_ontology_filter(self) -> None:
        r = self.client.post(
            "/biosamples",
            json={
                "query": {
                    "filters": [{"id": "EFO:0009655"}],
                    "pagination": {"skip": 0, "limit": 10},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        results = r.json()["response"]["resultSets"][0]["results"]
        self.assertTrue(results)
        self.assertEqual(
            results[0]["biosampleStatus"]["id"],
            "EFO:0009655",
        )

    def test_biosample_cell_culture_origin_filter(self) -> None:
        r = self.client.post(
            "/biosamples",
            json={
                "query": {
                    "filters": [{"id": "OBI:0001876"}],
                    "pagination": {"skip": 0, "limit": 10},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)

    def test_matrix_rejects_biosample_status_filter(self) -> None:
        r = self.client.post(
            "/matrices",
            json={
                "query": {
                    "filters": [{"id": "EFO:0009655"}],
                    "pagination": {"skip": 0, "limit": 5},
                }
            },
        )
        self.assertEqual(r.status_code, 400, r.text)

    def test_feature_go_ontology_filter(self) -> None:
        r = self.client.post(
            "/features",
            json={
                "query": {
                    "filters": [{"id": "GO:0008150"}],
                    "pagination": {"skip": 0, "limit": 10},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        results = r.json()["response"]["resultSets"][0]["results"]
        self.assertTrue(results)

    def test_matrix_rejects_go_filter(self) -> None:
        r = self.client.post(
            "/matrices",
            json={
                "query": {
                    "filters": [{"id": "GO:0008150"}],
                    "pagination": {"skip": 0, "limit": 5},
                }
            },
        )
        self.assertEqual(r.status_code, 400, r.text)

    def test_biosample_hp_severity_filter(self) -> None:
        r = self.client.post(
            "/biosamples",
            json={
                "query": {
                    "filters": [{"id": "HP:0012828"}],
                    "pagination": {"skip": 0, "limit": 10},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        results = r.json()["response"]["resultSets"][0]["results"]
        self.assertTrue(results)


if __name__ == "__main__":
    unittest.main()
