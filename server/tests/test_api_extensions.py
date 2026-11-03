"""Tests for matrix filters, summaries, and symbol resolution."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

class ApiExtensionsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import beacon.fixtures.store as st

        cls._saved_package = os.environ.pop("DATA_PACKAGE_PATH", None)
        st._STORE = None
        from fastapi.testclient import TestClient
        from app import app

        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls) -> None:
        import beacon.fixtures.store as st

        st._STORE = None
        if cls._saved_package:
            os.environ["DATA_PACKAGE_PATH"] = cls._saved_package
        else:
            os.environ.pop("DATA_PACKAGE_PATH", None)

    def test_root_filtering_terms_include_matrix_scope(self) -> None:
        r = self.client.get("/filtering_terms")
        self.assertEqual(r.status_code, 200)
        terms = r.json()["response"]["filteringTerms"]
        self.assertTrue(any(t["id"] == "matrix.unit" for t in terms))
        self.assertTrue(any(t.get("type") == "OBI" for t in terms))
        self.assertTrue(
            any("matrix" in (t.get("scopes") or []) for t in terms if t["id"] == "matrix.unit")
        )

    def test_matrix_scoped_filtering_terms(self) -> None:
        matrix_id = "matrix-gene-expression-001"
        r = self.client.get(f"/matrices/{matrix_id}/filtering_terms")
        self.assertEqual(r.status_code, 200, r.text)
        terms = r.json()["response"]["filteringTerms"]
        ids = {t["id"] for t in terms}
        self.assertIn("SO:0000704", ids)
        self.assertIn("GO:0008150", ids)
        resources = r.json()["response"].get("resources") or []
        prefixes = {
            str(res.get("nameSpacePrefix") or "").lower() for res in resources
        }
        self.assertIn("symbol", prefixes)
        self.assertTrue(
            "UBERON:0000474" in ids or "UBERON:0002107" in ids,
            msg=f"expected matrix tissues in {ids}",
        )
        root = self.client.get("/filtering_terms")
        root_ids = {t["id"] for t in root.json()["response"]["filteringTerms"]}
        self.assertTrue(root_ids.issuperset(ids))

    def test_matrix_scoped_filtering_terms_unknown_matrix(self) -> None:
        r = self.client.get("/matrices/no-such-matrix/filtering_terms")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["response"]["filteringTerms"], [])

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
        body = r.json()
        self.assertEqual(body["type"]["group"], "org.ga4gh")
        self.assertEqual(body["type"]["artifact"], "beacon")
        self.assertIn("url", body["organization"])
        self.assertNotIn("meta", body)

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

    def _feature_ids(self, response) -> set[str]:
        results = response.json()["response"]["resultSets"][0]["results"]
        return {row["id"] for row in results}

    def test_matrix_features_so_filter_is_matrix_scoped(self) -> None:
        r = self.client.get(
            "/matrices/matrix-gene-expression-001/features",
            params={"filters": "SO:0000704", "limit": 10},
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["responseSummary"]["numTotalResults"], 1)
        self.assertEqual(self._feature_ids(r), {"feature-tp53-gene"})

    def test_matrix_features_symbol_via_feature_id_list(self) -> None:
        r = self.client.get(
            "/matrices/matrix-gene-expression-001/features",
            params={"featureIDList": "TP53", "limit": 10},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["responseSummary"]["numTotalResults"], 1)
        self.assertEqual(self._feature_ids(r), {"feature-tp53-gene"})

    def test_matrix_features_symbol_filter_post(self) -> None:
        r = self.client.post(
            "/matrices/matrix-gene-expression-001/features",
            json={
                "query": {
                    "filters": [{"id": "symbol:TP53"}],
                    "pagination": {"skip": 0, "limit": 10},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self._feature_ids(r), {"feature-tp53-gene"})

    def test_matrix_features_value_range(self) -> None:
        r = self.client.get(
            "/matrices/matrix-gene-expression-001/features",
            params={"minValue": 90, "limit": 10},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self._feature_ids(r), {"feature-tp53-gene"})
        empty = self.client.get(
            "/matrices/matrix-gene-expression-001/features",
            params={"minValue": 200, "limit": 10},
        )
        self.assertEqual(empty.status_code, 200, empty.text)
        self.assertEqual(empty.json()["responseSummary"]["numTotalResults"], 0)

    def test_matrix_features_mixed_feature_and_biosample_filters(self) -> None:
        r = self.client.post(
            "/matrices/matrix-gene-expression-001/features",
            json={
                "query": {
                    "filters": [
                        {"id": "SO:0000704"},
                        {"id": "UBERON:0002107"},
                    ],
                    "pagination": {"skip": 0, "limit": 10},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self._feature_ids(r), {"feature-tp53-gene"})
        none = self.client.post(
            "/matrices/matrix-gene-expression-001/features",
            json={
                "query": {
                    "filters": [
                        {"id": "SO:0000234"},
                        {"id": "UBERON:0002107"},
                    ],
                    "pagination": {"skip": 0, "limit": 10},
                }
            },
        )
        self.assertEqual(none.status_code, 200, none.text)
        self.assertEqual(none.json()["responseSummary"]["numTotalResults"], 0)

    def test_matrix_features_rejects_matrix_scoped_filter(self) -> None:
        r = self.client.post(
            "/matrices/matrix-gene-expression-001/features",
            json={
                "query": {
                    "filters": [
                        {"id": "matrix.unit", "operator": "=", "value": "TPM"}
                    ],
                    "pagination": {"skip": 0, "limit": 5},
                }
            },
        )
        self.assertEqual(r.status_code, 400, r.text)
        self.assertIn("matrix-scoped", r.json()["error"]["errorMessage"])

    def test_matrix_features_rejects_inverted_range(self) -> None:
        r = self.client.get(
            "/matrices/matrix-gene-expression-001/features",
            params={"minValue": 10, "maxValue": 1},
        )
        self.assertEqual(r.status_code, 400, r.text)

    def test_matrix_biosamples_id_list(self) -> None:
        r = self.client.get(
            "/matrices/matrix-gene-expression-001/biosamples",
            params={"biosampleIDList": "sample-example-0001", "limit": 10},
        )
        self.assertEqual(r.status_code, 200, r.text)
        results = r.json()["response"]["resultSets"][0]["results"]
        self.assertEqual([row["id"] for row in results], ["sample-example-0001"])

    def test_matrix_biosamples_feature_id_list(self) -> None:
        r = self.client.get(
            "/matrices/matrix-gene-expression-001/biosamples",
            params={"featureIDList": "TP53", "limit": 10},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["responseSummary"]["numTotalResults"], 2)

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
