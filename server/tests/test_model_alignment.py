"""Alignment of the API with the beacon-v2 matrix / feature / expressionValue models."""

from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
TESTS_DIR = Path(__file__).resolve().parent
for p in (SERVER_DIR, TESTS_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from beacon_test_helpers import with_meta

SCHEMAS = SERVER_DIR.parent / "beacon-schemas"


def _results(resp):
    return resp.json()["response"]["resultSets"][0]["results"]


class ModelAlignmentTest(unittest.TestCase):
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

    def test_matrix_documents_match_model_schema(self) -> None:
        import jsonschema

        schema = json.loads((SCHEMAS / "matrix.json").read_text())
        schema.pop("$schema", None)
        validator = jsonschema.Draft202012Validator(schema)
        rows = _results(self.client.get("/matrices", params={"limit": 50}))
        self.assertTrue(rows)
        for row in rows:
            self.assertIn("id", row)
            self.assertNotIn("matrixId", row)
            self.assertEqual([e.message for e in validator.iter_errors(row)], [])

    def test_matrix_detail_uses_id(self) -> None:
        rows = _results(self.client.get("/matrices", params={"limit": 1}))
        mid = rows[0]["id"]
        detail = _results(self.client.get(f"/matrices/{mid}"))
        self.assertEqual(detail[0]["id"], mid)

    def test_expression_value_keeps_matrix_id_reference(self) -> None:
        mid = _results(self.client.get("/matrices", params={"limit": 1}))[0]["id"]
        rows = _results(
            self.client.get(f"/matrices/{mid}/expression_values", params={"limit": 2})
        )
        for row in rows:
            self.assertEqual(row["matrixId"], mid)

    def test_expression_values_default_order_is_descending(self) -> None:
        mid = _results(self.client.get("/matrices", params={"limit": 1}))[0]["id"]
        for resp in (
            self.client.get(f"/matrices/{mid}/expression_values", params={"limit": 20}),
            self.client.post(
                f"/matrices/{mid}/expression_values",
                json=with_meta({"query": {"pagination": {"skip": 0, "limit": 20}}}),
            ),
        ):
            self.assertEqual(resp.status_code, 200, resp.text)
            values = [r["value"] for r in _results(resp)]
            self.assertEqual(values, sorted(values, reverse=True))

    def test_invalid_order_rejected(self) -> None:
        mid = _results(self.client.get("/matrices", params={"limit": 1}))[0]["id"]
        r = self.client.post(
            f"/matrices/{mid}/expression_values",
            json=with_meta({
                "query": {"requestParameters": {"expressionValue": {"order": "up"}}}
            }),
        )
        self.assertEqual(r.status_code, 400, r.text)

    def test_get_include_resultset_responses_and_requested_schema(self) -> None:
        for path in ("/matrices", "/features", "/biosamples"):
            ok = self.client.get(
                path, params={"includeResultsetResponses": "NONE", "requestedSchema": "x"}
            )
            self.assertEqual(ok.status_code, 200, ok.text)
            self.assertEqual(ok.json()["response"]["resultSets"], [])
            bad = self.client.get(path, params={"includeResultsetResponses": "bogus"})
            self.assertEqual(bad.status_code, 400, bad.text)

    def test_nested_matrix_filtering_terms_removed(self) -> None:
        mid = _results(self.client.get("/matrices", params={"limit": 1}))[0]["id"]
        self.assertEqual(
            self.client.get(f"/matrices/{mid}/filtering_terms").status_code, 404
        )
        self.assertEqual(
            self.client.post(
                f"/matrices/{mid}/filtering_terms", json=with_meta({})
            ).status_code,
            404,
        )

    def test_removed_id_list_parameters_not_accepted_as_request_parameters(self) -> None:
        for path, entity, key in (
            ("/features", "feature", "featureIDList"),
            ("/biosamples", "biosample", "biosampleIDList"),
            ("/features/feature-tp53-gene/matrices", "matrix", "matrixIDList"),
        ):
            r = self.client.post(
                path,
                json=with_meta({"query": {"requestParameters": {entity: {key: "x"}}}}),
            )
            self.assertEqual(r.status_code, 400, f"{path}: {r.text}")

    def test_entry_types_versions_match_model(self) -> None:
        entry = self.client.get("/entry_types").json()["response"]["entryTypes"]
        self.assertEqual(entry["matrix"]["defaultSchema"]["schemaVersion"], "v2.1.2")
        self.assertEqual(entry["feature"]["defaultSchema"]["schemaVersion"], "v2.1.2")
        self.assertEqual(entry["matrix"]["ontologyTermForThisType"]["id"], "edam:data_2603")


if __name__ == "__main__":
    unittest.main()
