"""Smoke tests for filtering_terms catalog + query.filters (fixture store)."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

import yaml

SERVER_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVER_DIR.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

class FiltersSmokeTest(unittest.TestCase):
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

    def test_catalog_has_no_gene_curie_terms(self) -> None:
        r = self.client.get("/filtering_terms")
        self.assertEqual(r.status_code, 200)
        body = r.json()["response"]
        terms = body["filteringTerms"]
        resources = {x["id"] for x in body["resources"]}
        self.assertTrue(terms)
        self.assertTrue({"so", "hgnc", "ncbigene", "ensembl"} <= resources)
        self.assertIn("efo", resources)
        self.assertTrue(any(t["id"] == "sex" for t in terms))
        term_ids = {t["id"] for t in terms}
        self.assertNotIn("GEO:sample", term_ids)
        self.assertNotIn("resource:gencode", term_ids)
        for t in terms:
            self.assertFalse(
                str(t["id"]).startswith(("HGNC:", "NCBIGene:", "ENSEMBL:")),
                msg=t["id"],
            )

    def test_hgnc_and_symbol_filters(self) -> None:
        r = self.client.post(
            "/features",
            json={
                "query": {
                    "filters": [{"id": "HGNC:11998"}],
                    "pagination": {"skip": 0, "limit": 5},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertGreaterEqual(r.json()["responseSummary"]["numTotalResults"], 1)

        r = self.client.post(
            "/features",
            json={
                "query": {
                    "filters": [{"id": "symbol:TP53"}],
                    "pagination": {"skip": 0, "limit": 5},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertGreaterEqual(r.json()["responseSummary"]["numTotalResults"], 1)

        r = self.client.get(
            "/features",
            params={"filters": "symbol:TP53", "limit": 5},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertGreaterEqual(r.json()["responseSummary"]["numTotalResults"], 1)

        bad = self.client.get(
            "/features",
            params={"filters": "symbol:", "limit": 5},
        )
        self.assertEqual(bad.status_code, 400, bad.text)

        r = self.client.get("/filtering_terms")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()["response"]
        term_ids = {t["id"] for t in body["filteringTerms"]}
        self.assertIn("GO:0008150", term_ids)
        prefixes = {
            str(res.get("nameSpacePrefix") or "").lower()
            for res in body.get("resources") or []
        }
        self.assertIn("go", prefixes)
        self.assertIn("symbol", prefixes)

    def test_ensembl_unversioned_curie(self) -> None:
        r = self.client.post(
            "/features",
            json={
                "query": {
                    "filters": [{"id": "ENSEMBL:ENSG00000141510"}],
                    "pagination": {"skip": 0, "limit": 5},
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertGreaterEqual(r.json()["responseSummary"]["numTotalResults"], 1)

    def test_unknown_prefix_400(self) -> None:
        r = self.client.post(
            "/features",
            json={"query": {"filters": [{"id": "HP:0000001"}]}},
        )
        self.assertEqual(r.status_code, 400)

    def test_openapi_beacon_query_filters(self) -> None:
        schema_path = REPO_ROOT / "rnaget-beacon-schema.yaml"
        self.assertTrue(schema_path.is_file())
        sch = yaml.safe_load(schema_path.read_text(encoding="utf-8"))
        bq = sch["components"]["schemas"]["BeaconQuery"]
        self.assertIn("properties", bq)
        self.assertIn("filters", bq["properties"])
        self.assertNotEqual(
            bq.get("$ref"), "#/components/schemas/BeaconQuery"
        )


if __name__ == "__main__":
    unittest.main()
