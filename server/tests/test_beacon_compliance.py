"""Map vs routes and Beacon v2 response envelope compliance."""

from __future__ import annotations

import json
import os
import re
import sys
import unittest
from pathlib import Path
from typing import Any, Dict

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

_FIXTURES = SERVER_DIR / "beacon" / "fixtures" / "data"

_COLLECTIONS = ("/matrices", "/features", "/biosamples")
_GRANULARITIES = ("record", "count", "boolean")


def _assert_received_summary(summary: Dict[str, Any], *, entity_type: str) -> None:
    for key in (
        "apiVersion",
        "requestedSchemas",
        "pagination",
        "requestedGranularity",
    ):
        assert key in summary, f"missing receivedRequestSummary.{key}"
    assert isinstance(summary["requestedSchemas"], list)
    assert summary["requestedSchemas"], "expected non-empty requestedSchemas"
    assert summary["requestedSchemas"][0]["entityType"] == entity_type
    assert "schema" in summary["requestedSchemas"][0]
    pag = summary["pagination"]
    assert "skip" in pag and "limit" in pag


def _assert_query_meta(meta: Dict[str, Any], *, entity_type: str, granularity: str) -> None:
    assert meta.get("returnedGranularity") == granularity
    _assert_received_summary(meta["receivedRequestSummary"], entity_type=entity_type)
    assert meta["receivedRequestSummary"]["requestedGranularity"] == granularity
    assert meta.get("beaconId")
    assert meta.get("apiVersion")
    assert meta.get("returnedSchemas")


def _assert_informational_meta(meta: Dict[str, Any]) -> None:
    assert meta.get("beaconId")
    assert meta.get("apiVersion")
    assert meta.get("returnedSchemas")
    assert "returnedGranularity" not in meta
    assert "receivedRequestSummary" not in meta


def _assert_error_meta(meta: Dict[str, Any]) -> None:
    assert meta.get("returnedGranularity")
    summary = meta.get("receivedRequestSummary")
    assert isinstance(summary, dict)
    for key in (
        "apiVersion",
        "requestedSchemas",
        "pagination",
        "requestedGranularity",
    ):
        assert key in summary, f"missing error receivedRequestSummary.{key}"


class BeaconComplianceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import beacon.fixtures.store as st

        cls._saved_package = os.environ.pop("DATA_PACKAGE_PATH", None)
        st._STORE = None
        from fastapi.testclient import TestClient
        from app import app

        cls.client = TestClient(app)
        cls.routes = {getattr(r, "path", None) for r in app.routes}

    @classmethod
    def tearDownClass(cls) -> None:
        import beacon.fixtures.store as st

        st._STORE = None
        if cls._saved_package:
            os.environ["DATA_PACKAGE_PATH"] = cls._saved_package
        else:
            os.environ.pop("DATA_PACKAGE_PATH", None)

    def test_map_urls_resolve_to_routes(self) -> None:
        doc = json.loads((_FIXTURES / "beaconMap.json").read_text(encoding="utf-8"))
        paths: set[str] = set()
        for block in (doc.get("endpointSets") or {}).values():
            root = block.get("rootUrl", "")
            if root:
                paths.add(re.sub(r"https?://[^/]+", "", root))
            single = block.get("singleEntryUrl")
            if single:
                paths.add(
                    re.sub(r"https?://[^/]+", "", single).replace("{id}", "{id}")
                )
            for ep in (block.get("endpoints") or {}).values():
                url = ep.get("url", "")
                paths.add(re.sub(r"https?://[^/]+", "", url))
            filtering_terms = block.get("filteringTermsUrl")
            if filtering_terms:
                paths.add(re.sub(r"https?://[^/]+", "", filtering_terms))
        for path in paths:
            if not path:
                continue
            template = path if path.startswith("/") else f"/{path}"
            self.assertIn(
                template,
                self.routes,
                msg=f"map path {template} not registered",
            )

    def test_collection_granularities_envelope(self) -> None:
        entity_by_path = {
            "/matrices": "matrix",
            "/features": "feature",
            "/biosamples": "biosample",
        }
        for path in _COLLECTIONS:
            entity = entity_by_path[path]
            for gran in _GRANULARITIES:
                with self.subTest(path=path, granularity=gran):
                    r = self.client.get(
                        path,
                        params={"requestedGranularity": gran, "limit": 5},
                    )
                    self.assertEqual(r.status_code, 200, r.text)
                    body = r.json()
                    _assert_query_meta(
                        body["meta"], entity_type=entity, granularity=gran
                    )
                    if gran == "record":
                        self.assertIn("response", body)
                        sets = body["response"]["resultSets"]
                        self.assertTrue(sets)
                        rs = sets[0]
                        self.assertIn("id", rs)
                        self.assertIn("setType", rs)
                        self.assertEqual(rs["setType"], entity)
                        self.assertIn("exists", rs)
                        self.assertIn("results", rs)
                    else:
                        self.assertNotIn("response", body)
                        self.assertIn("responseSummary", body)
                        self.assertIn("exists", body["responseSummary"])
                        if gran == "count":
                            self.assertIn(
                                "numTotalResults", body["responseSummary"]
                            )

    def test_validation_error_beacon_shape(self) -> None:
        r = self.client.get("/matrices", params={"limit": -1})
        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertIn("error", body)
        self.assertIn("meta", body)
        _assert_error_meta(body["meta"])
        self.assertEqual(body["meta"]["returnedGranularity"], "record")
        self.assertEqual(
            body["meta"]["receivedRequestSummary"]["requestedSchemas"], []
        )

    def test_post_pagination_error_echoes_query(self) -> None:
        from routers.deps import MAX_SKIP

        r = self.client.post(
            "/matrices/matrix-gene-expression-001/expression_values",
            json={
                "query": {
                    "pagination": {"skip": MAX_SKIP + 1, "limit": 5},
                }
            },
        )
        self.assertEqual(r.status_code, 400, r.text)
        summary = r.json()["meta"]["receivedRequestSummary"]
        self.assertEqual(
            summary["pagination"], {"skip": MAX_SKIP + 1, "limit": 5}
        )
        self.assertEqual(
            summary["requestedSchemas"][0]["entityType"], "expressionValue"
        )

    def test_post_filter_error_meta(self) -> None:
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
        body = r.json()
        _assert_error_meta(body["meta"])
        summary = body["meta"]["receivedRequestSummary"]
        self.assertEqual(summary["requestedGranularity"], "record")
        self.assertEqual(summary["pagination"], {"skip": 0, "limit": 5})
        self.assertEqual(summary["requestedSchemas"][0]["entityType"], "matrix")

    def test_informational_endpoints_envelope(self) -> None:
        for path in ("/", "/filtering_terms", "/map"):
            with self.subTest(path=path):
                r = self.client.get(path)
                self.assertEqual(r.status_code, 200, r.text)
                body = r.json()
                _assert_informational_meta(body["meta"])
                self.assertIn("response", body)

    def test_unknown_feature_id_empty_200(self) -> None:
        r = self.client.get(
            "/features/__no_such_feature__",
            params={"requestedGranularity": "boolean"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertFalse(r.json()["responseSummary"]["exists"])

    def test_empty_cohort_matrix_features(self) -> None:
        r = self.client.post(
            "/matrices/matrix-gene-expression-001/features",
            json={
                "query": {
                    "filters": [
                        {
                            "id": "condition",
                            "operator": "=",
                            "value": "__none__",
                        }
                    ],
                    "pagination": {"skip": 0, "limit": 5},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["responseSummary"]["numTotalResults"], 0)


if __name__ == "__main__":
    unittest.main()
