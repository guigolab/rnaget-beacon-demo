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

    def test_expression_summary_by_symbol(self) -> None:
        r = self.client.get(
            "/matrices/matrix-gene-expression-001/expression_summary",
            params={"featureIDList": "TP53", "requestedGranularity": "record"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["responseSummary"]["exists"])

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
                },
                "featureIDList": "TP53",
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["responseSummary"]["numTotalResults"], 0)

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


if __name__ == "__main__":
    unittest.main()
