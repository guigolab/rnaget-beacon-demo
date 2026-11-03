"""Smoke tests for server-side ``expression.*`` filtering terms and the
``expression_values`` enhancements (feature/biosample filters, minValue sugar,
page tokens, matrix-only rejection at root scope).

Fixture-backed tests run without ``DATA_PACKAGE_PATH`` (always-on). Tests that
need real per-matrix expression stats / percentile parquet run against the
checked-in demo data package and are skipped when it is unavailable.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVER_DIR.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

DEMO_PACKAGE = (REPO_ROOT / "data" / "rnaget-demo").resolve()
HAS_DEMO_PACKAGE = (DEMO_PACKAGE / "manifest.json").is_file()


class ExpressionFiltersFixtureTest(unittest.TestCase):
    """Router-level behaviour that does not depend on expression stats."""

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

    def test_matrix_only_filter_rejected_on_root_features(self) -> None:
        r = self.client.get(
            "/features", params={"filters": "expression.median:>=:10"}
        )
        self.assertEqual(r.status_code, 400, r.text)
        self.assertIn("matrix-only", r.json()["error"]["errorMessage"])

    def test_matrix_only_filter_rejected_on_root_biosamples(self) -> None:
        r = self.client.get(
            "/biosamples", params={"filters": "expression.detectedGenes:>=:5"}
        )
        self.assertEqual(r.status_code, 400, r.text)
        self.assertIn("matrix-only", r.json()["error"]["errorMessage"])

    def test_matrix_only_filter_rejected_via_post(self) -> None:
        r = self.client.post(
            "/features",
            json={
                "query": {
                    "filters": [
                        {"id": "expression.mean", "operator": ">=", "value": "1"}
                    ],
                    "pagination": {"skip": 0, "limit": 5},
                }
            },
        )
        self.assertEqual(r.status_code, 400, r.text)

    def test_feature_matrices_with_matrix_id_list(self) -> None:
        r = self.client.get(
            "/features/feature-tp53-gene/matrices",
            params={"matrixIDList": "matrix-gene-expression-001"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        results = r.json()["response"]["resultSets"][0]["results"]
        self.assertEqual([m["matrixId"] for m in results], ["matrix-gene-expression-001"])

    def test_feature_matrices_post_with_matrix_id_list(self) -> None:
        r = self.client.post(
            "/features/feature-tp53-gene/matrices",
            json={
                "query": {
                    "requestParameters": {"matrixIDList": "GSE88557"},
                    "pagination": {"skip": 0, "limit": 5},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        results = r.json()["response"]["resultSets"][0]["results"]
        self.assertEqual([m["matrixId"] for m in results], ["GSE88557"])

    def test_biosample_matrices_endpoint_still_works(self) -> None:
        r = self.client.get("/biosamples/sample-example-0001/matrices")
        self.assertEqual(r.status_code, 200, r.text)

    def test_expression_values_id_sort_default(self) -> None:
        r = self.client.get(
            "/matrices/matrix-gene-expression-001/expression_values",
            params={"limit": 50},
        )
        self.assertEqual(r.status_code, 200, r.text)
        rp = r.json()["meta"]["receivedRequestSummary"]["requestParameters"]
        self.assertEqual(rp["sort"], "id")
        rows = r.json()["response"]["resultSets"][0]["results"]
        ids = [(row["featureId"], row["biosampleId"]) for row in rows]
        self.assertEqual(ids, sorted(ids))

    def test_expression_values_percentile_filter_empty_without_percentiles(
        self,
    ) -> None:
        """Fixtures carry no percentile parquet: the filter yields zero rows."""
        r = self.client.get(
            "/matrices/matrix-gene-expression-001/expression_values",
            params={"filters": "expression.percentileInFeature:>=:90", "limit": 5},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["responseSummary"]["numTotalResults"], 0)

    def test_expression_values_page_token_roundtrip(self) -> None:
        page1 = self.client.get(
            "/matrices/matrix-gene-expression-001/expression_values",
            params={"limit": 1},
        )
        self.assertEqual(page1.status_code, 200, page1.text)
        next_token = page1.json()["meta"]["receivedRequestSummary"]["pagination"].get(
            "nextPage"
        )
        if not next_token:
            self.skipTest("fixture matrix has only one expression cell")
        page2 = self.client.get(
            "/matrices/matrix-gene-expression-001/expression_values",
            params={"limit": 1, "pageToken": next_token},
        )
        self.assertEqual(page2.status_code, 200, page2.text)
        row1 = page1.json()["response"]["resultSets"][0]["results"][0]
        row2 = page2.json()["response"]["resultSets"][0]["results"][0]
        self.assertNotEqual(
            (row1["featureId"], row1["biosampleId"]),
            (row2["featureId"], row2["biosampleId"]),
        )


@unittest.skipUnless(
    HAS_DEMO_PACKAGE, f"demo data package not found at {DEMO_PACKAGE}"
)
class ExpressionFiltersDuckDBTest(unittest.TestCase):
    """Tests that exercise real per-matrix expression stats / percentiles."""

    @classmethod
    def setUpClass(cls) -> None:
        import beacon.fixtures.store as st

        cls._saved_package = os.environ.get("DATA_PACKAGE_PATH")
        os.environ["DATA_PACKAGE_PATH"] = str(DEMO_PACKAGE)
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

    def test_filtering_terms_include_expression_band(self) -> None:
        r = self.client.get("/filtering_terms")
        self.assertEqual(r.status_code, 200, r.text)
        term_ids = {t["id"] for t in r.json()["response"]["filteringTerms"]}
        self.assertIn("expression.percentile.80-100", term_ids)
        self.assertIn("expression.detectedGenesPercentile.0-20", term_ids)
        self.assertTrue(
            any(t.startswith("expression.enrichedIn:") for t in term_ids)
        )

    def test_post_features_expression_band_high(self) -> None:
        r = self.client.post(
            "/features",
            json={
                "query": {
                    "filters": [{"id": "expression.percentile.80-100"}],
                    "pagination": {"skip": 0, "limit": 5},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertGreater(r.json()["responseSummary"]["numTotalResults"], 0)
        results = r.json()["response"]["resultSets"][0]["results"]
        self.assertTrue(results)

        # The matrix-only continuous counterpart is still rejected at root.
        rejected = self.client.get(
            "/features", params={"filters": "expression.median:>=:10"}
        )
        self.assertEqual(rejected.status_code, 400, rejected.text)

    def test_post_feature_matrices_with_band_and_matrix_id_list(self) -> None:
        picked = self.client.post(
            "/features",
            json={
                "query": {
                    "filters": [{"id": "expression.percentile.80-100"}],
                    "pagination": {"skip": 0, "limit": 1},
                }
            },
        )
        self.assertEqual(picked.status_code, 200, picked.text)
        feature = picked.json()["response"]["resultSets"][0]["results"][0]
        feature_id = feature["id"]
        matrix_ids = feature["matrixIds"]
        self.assertTrue(matrix_ids)

        r = self.client.post(
            f"/features/{feature_id}/matrices",
            json={
                "query": {
                    "filters": [{"id": "expression.percentile.80-100"}],
                    "requestParameters": {"matrixIDList": ",".join(matrix_ids)},
                    "pagination": {"skip": 0, "limit": 20},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        results = r.json()["response"]["resultSets"][0]["results"]
        self.assertTrue(results)
        self.assertTrue(set(m["matrixId"] for m in results) <= set(matrix_ids))

    def test_biosample_matrices_with_detected_genes_band(self) -> None:
        picked = self.client.post(
            "/biosamples",
            json={
                "query": {
                    "filters": [{"id": "expression.detectedGenesPercentile.0-20"}],
                    "pagination": {"skip": 0, "limit": 1},
                }
            },
        )
        self.assertEqual(picked.status_code, 200, picked.text)
        total = picked.json()["responseSummary"]["numTotalResults"]
        self.assertGreater(total, 0)
        biosample = picked.json()["response"]["resultSets"][0]["results"][0]
        biosample_id = biosample["id"]

        r = self.client.get(
            f"/biosamples/{biosample_id}/matrices",
            params={"filters": "expression.detectedGenesPercentile.0-20"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["response"]["resultSets"][0]["results"])

    def _first_matrix_id_with_percentiles(self) -> str:
        for entry in DEMO_PACKAGE.glob("matrices/*/percentile_in_feature.parquet"):
            return entry.parent.name
        raise self.skipTest("no matrix with percentile parquet in demo package")  # type: ignore[misc]

    def test_expression_values_min_value_sugar_and_page_token_roundtrip(
        self,
    ) -> None:
        matrix_id = self._first_matrix_id_with_percentiles()

        page1 = self.client.get(
            f"/matrices/{matrix_id}/expression_values",
            params={"minValue": 10, "limit": 3},
        )
        self.assertEqual(page1.status_code, 200, page1.text)
        body1 = page1.json()
        self.assertGreater(body1["responseSummary"]["numTotalResults"], 3)
        rows1 = body1["response"]["resultSets"][0]["results"]
        self.assertEqual(len(rows1), 3)
        for row in rows1:
            self.assertGreaterEqual(row["value"], 10)
        pagination1 = body1["meta"]["receivedRequestSummary"]["pagination"]
        next_token = pagination1.get("nextPage")
        self.assertTrue(next_token)

        page2 = self.client.get(
            f"/matrices/{matrix_id}/expression_values",
            params={"minValue": 10, "limit": 3, "pageToken": next_token},
        )
        self.assertEqual(page2.status_code, 200, page2.text)
        body2 = page2.json()
        rows2 = body2["response"]["resultSets"][0]["results"]
        self.assertEqual(len(rows2), 3)
        pair1 = {(r["featureId"], r["biosampleId"]) for r in rows1}
        pair2 = {(r["featureId"], r["biosampleId"]) for r in rows2}
        self.assertFalse(pair1 & pair2, "page 2 must not repeat page 1 rows")

        pagination2 = body2["meta"]["receivedRequestSummary"]["pagination"]
        prev_token = pagination2.get("previousPage")
        self.assertTrue(prev_token)
        back = self.client.get(
            f"/matrices/{matrix_id}/expression_values",
            params={"minValue": 10, "limit": 3, "pageToken": prev_token},
        )
        self.assertEqual(back.status_code, 200, back.text)
        rows_back = back.json()["response"]["resultSets"][0]["results"]
        pair_back = [(r["featureId"], r["biosampleId"]) for r in rows_back]
        self.assertEqual(pair_back, [(r["featureId"], r["biosampleId"]) for r in rows1])

    def test_expression_values_percentile_filter(self) -> None:
        matrix_id = self._first_matrix_id_with_percentiles()
        r = self.client.get(
            f"/matrices/{matrix_id}/expression_values",
            params={"filters": "expression.percentileInFeature:>=:90", "limit": 5},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertGreater(r.json()["responseSummary"]["numTotalResults"], 0)

    def test_expression_values_feature_filter_band(self) -> None:
        matrix_id = self._first_matrix_id_with_percentiles()
        r = self.client.get(
            f"/matrices/{matrix_id}/expression_values",
            params={"filters": "expression.percentile.80-100", "limit": 5},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertGreaterEqual(r.json()["responseSummary"]["numTotalResults"], 0)

    def test_expression_values_value_filter(self) -> None:
        matrix_id = self._first_matrix_id_with_percentiles()
        r = self.client.get(
            f"/matrices/{matrix_id}/expression_values",
            params={"filters": "expression.value:>=:10", "limit": 3},
        )
        self.assertEqual(r.status_code, 200, r.text)
        rows = r.json()["response"]["resultSets"][0]["results"]
        for row in rows:
            self.assertGreaterEqual(row["value"], 10)

    def test_expression_values_value_sort_prev_with_ties(self) -> None:
        """previousPage under sort=value must survive equal cell values."""
        # Prefer a matrix known to have many exact-zero ties.
        matrix_id = "ENCSR622FSM"
        if not (DEMO_PACKAGE / "matrices" / matrix_id / "expression.parquet").is_file():
            matrix_id = self._first_matrix_id_with_percentiles()

        page1 = self.client.get(
            f"/matrices/{matrix_id}/expression_values",
            params={"sort": "value", "order": "asc", "maxValue": 0, "limit": 2},
        )
        self.assertEqual(page1.status_code, 200, page1.text)
        body1 = page1.json()
        if body1["responseSummary"]["numTotalResults"] < 4:
            self.skipTest("not enough tied zero-value cells")
        rows1 = body1["response"]["resultSets"][0]["results"]
        self.assertEqual(len(rows1), 2)
        self.assertTrue(all(r["value"] == 0 for r in rows1))
        next_token = body1["meta"]["receivedRequestSummary"]["pagination"].get(
            "nextPage"
        )
        self.assertTrue(next_token)

        page2 = self.client.get(
            f"/matrices/{matrix_id}/expression_values",
            params={
                "sort": "value",
                "order": "asc",
                "maxValue": 0,
                "limit": 2,
                "pageToken": next_token,
            },
        )
        self.assertEqual(page2.status_code, 200, page2.text)
        rows2 = page2.json()["response"]["resultSets"][0]["results"]
        self.assertEqual(len(rows2), 2)
        self.assertFalse(
            {(r["featureId"], r["biosampleId"]) for r in rows1}
            & {(r["featureId"], r["biosampleId"]) for r in rows2}
        )
        prev_token = page2.json()["meta"]["receivedRequestSummary"]["pagination"].get(
            "previousPage"
        )
        self.assertTrue(prev_token)

        back = self.client.get(
            f"/matrices/{matrix_id}/expression_values",
            params={
                "sort": "value",
                "order": "asc",
                "maxValue": 0,
                "limit": 2,
                "pageToken": prev_token,
            },
        )
        self.assertEqual(back.status_code, 200, back.text)
        rows_back = back.json()["response"]["resultSets"][0]["results"]
        self.assertEqual(
            [(r["featureId"], r["biosampleId"], r["value"]) for r in rows_back],
            [(r["featureId"], r["biosampleId"], r["value"]) for r in rows1],
        )


if __name__ == "__main__":
    unittest.main()
