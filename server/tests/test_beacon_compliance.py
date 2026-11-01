"""Map vs routes and error envelope smoke tests."""

from __future__ import annotations

import json
import os
import re
import sys
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

os.environ.pop("DATA_PACKAGE_PATH", None)

_FIXTURES = SERVER_DIR / "beacon" / "fixtures" / "data"


class BeaconComplianceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import beacon.fixtures.store as st

        st._STORE = None
        from fastapi.testclient import TestClient
        from app import app

        cls.client = TestClient(app)
        cls.routes = {getattr(r, "path", None) for r in app.routes}

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
        for path in paths:
            if not path:
                continue
            # FastAPI uses {id} in path templates
            template = path if path.startswith("/") else f"/{path}"
            self.assertIn(
                template,
                self.routes,
                msg=f"map path {template} not registered",
            )

    def test_validation_error_beacon_shape(self) -> None:
        r = self.client.get("/matrices", params={"limit": 0})
        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertIn("error", body)
        self.assertIn("meta", body)
        self.assertIn("receivedRequestSummary", body["meta"])

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
