"""Tissue high/specific custom filters + filtering_terms payload shape."""

from __future__ import annotations

import os
import unittest
from pathlib import Path

from beacon.expression_filter_maps import (
    parse_tissue_feature_filter,
    tissue_high_filter_id,
    tissue_present_filter_id,
    tissue_specific_filter_id,
    tissue_top_filter_id,
)
from beacon.filters import (
    feature_doc_matches,
    is_tissue_feature_filter,
    normalize_filters,
    validate_filters_for_entity,
)
from beacon.tissue_catalog import (
    MATRIX_PSEUDO_PREFIX,
    matrix_pseudo_ontology_id,
)

DEMO_PACKAGE = Path(
    os.environ.get(
        "RNAGET_BUILT_PACKAGE",
        str(Path(__file__).resolve().parents[2] / "data" / "rnaget-demo"),
    )
)
HAS_DEMO_PACKAGE = (DEMO_PACKAGE / "manifest.json").is_file()
HAS_TISSUE_SUMMARY = (DEMO_PACKAGE / "tissue_feature_summary.parquet").is_file()
HAS_TISSUE_STATS = any(
    (DEMO_PACKAGE / "matrices").glob("*/tissue_expression_stats.parquet")
) if HAS_DEMO_PACKAGE else False


class TissueFilterParseTest(unittest.TestCase):
    def test_parse_and_normalize_custom(self) -> None:
        fid = tissue_high_filter_id("UBERON:0002107")
        self.assertEqual(parse_tissue_feature_filter(fid), ("high", "UBERON:0002107"))
        filt = normalize_filters([{"id": fid}])[0]
        self.assertTrue(is_tissue_feature_filter(filt))
        self.assertEqual(filt.kind, "custom")
        self.assertIsNone(validate_filters_for_entity([filt], entity="feature"))

    def test_specific_parse(self) -> None:
        fid = tissue_specific_filter_id("EFO:0004167")
        self.assertEqual(parse_tissue_feature_filter(fid), ("specific", "EFO:0004167"))

    def test_matrix_pseudo_parse(self) -> None:
        oid = matrix_pseudo_ontology_id("GSE107011")
        fid = tissue_high_filter_id(oid)
        self.assertEqual(parse_tissue_feature_filter(fid), ("high", oid))
        self.assertTrue(oid.startswith(MATRIX_PSEUDO_PREFIX))

    def test_malformed_rejected(self) -> None:
        bad = normalize_filters([{"id": "tissueHigh:"}])[0]
        err = validate_filters_for_entity([bad], entity="feature")
        self.assertIsNotNone(err)

    def test_fixture_doc_match_via_tissue_levels(self) -> None:
        doc = {
            "id": "f1",
            "featureIdentifier": {"id": "ENSG1", "resource": "gencode"},
            "info": {"tissueLevels": {"UBERON:0002107": 2}},
        }
        high = normalize_filters([{"id": tissue_high_filter_id("UBERON:0002107")}])
        self.assertTrue(feature_doc_matches(doc, high))
        specific = normalize_filters(
            [{"id": tissue_specific_filter_id("UBERON:0002107")}]
        )
        self.assertTrue(feature_doc_matches(doc, specific))
        # High but not specific
        doc2 = {
            **doc,
            "info": {"tissueLevels": {"UBERON:0002107": 1, "UBERON:0000178": 1}},
        }
        self.assertTrue(feature_doc_matches(doc2, high))
        self.assertFalse(feature_doc_matches(doc2, specific))
        # Below (level 0) is not high
        doc3 = {**doc, "info": {"tissueLevels": {"UBERON:0002107": 0}}}
        self.assertFalse(feature_doc_matches(doc3, high))
        # Absent key is not high
        doc4 = {**doc, "info": {"tissueLevels": {"UBERON:0000178": 1}}}
        self.assertFalse(feature_doc_matches(doc4, high))

    def test_fixture_doc_match_tissue_top_via_bands(self) -> None:
        fid = tissue_top_filter_id("UBERON:0002107")
        self.assertEqual(parse_tissue_feature_filter(fid), ("top", "UBERON:0002107"))
        top = normalize_filters([{"id": fid}])
        self.assertTrue(is_tissue_feature_filter(top[0]))
        hit = {
            "id": "f1",
            "info": {"tissueBands": {"UBERON:0002107": 99}},
        }
        miss = {
            "id": "f2",
            "info": {"tissueBands": {"UBERON:0002107": 0}},
        }
        absent = {"id": "f3", "info": {"tissueBands": {}}}
        self.assertTrue(feature_doc_matches(hit, top))
        self.assertFalse(feature_doc_matches(miss, top))
        self.assertFalse(feature_doc_matches(absent, top))

    def test_fixture_doc_match_tissue_present(self) -> None:
        fid = tissue_present_filter_id("UBERON:0002107")
        self.assertEqual(parse_tissue_feature_filter(fid), ("present", "UBERON:0002107"))
        present = normalize_filters([{"id": fid}])
        self.assertTrue(is_tissue_feature_filter(present[0]))
        top_band = {
            "id": "f1",
            "info": {"tissueBands": {"UBERON:0002107": 99}},
        }
        low_band = {
            "id": "f2",
            "info": {"tissueBands": {"UBERON:0002107": 0}},
        }
        absent = {"id": "f3", "info": {"tissueBands": {}}}
        via_levels = {
            "id": "f4",
            "info": {"tissueLevels": {"UBERON:0002107": 0}},
        }
        self.assertTrue(feature_doc_matches(top_band, present))
        self.assertTrue(feature_doc_matches(low_band, present))
        self.assertFalse(feature_doc_matches(absent, present))
        self.assertTrue(feature_doc_matches(via_levels, present))

    def test_fixture_doc_match_via_legacy_high_ids(self) -> None:
        doc = {
            "id": "f1",
            "featureIdentifier": {"id": "ENSG1", "resource": "gencode"},
            "info": {"tissueHighOntologyIds": ["UBERON:0002107"]},
        }
        high = normalize_filters([{"id": tissue_high_filter_id("UBERON:0002107")}])
        self.assertTrue(feature_doc_matches(doc, high))
        specific = normalize_filters(
            [{"id": tissue_specific_filter_id("UBERON:0002107")}]
        )
        self.assertTrue(feature_doc_matches(doc, specific))
        doc2 = {
            **doc,
            "info": {
                "tissueHighOntologyIds": ["UBERON:0002107", "UBERON:0000178"],
            },
        }
        self.assertFalse(feature_doc_matches(doc2, specific))


class TissueFilteringTermsFixtureTest(unittest.TestCase):
    """Beacon payload shape for root filtering_terms (fixture store)."""

    def setUp(self) -> None:
        import beacon.fixtures.store as st

        self._saved = os.environ.pop("DATA_PACKAGE_PATH", None)
        st._STORE = None

    def tearDown(self) -> None:
        import beacon.fixtures.store as st

        st._STORE = None
        if self._saved is not None:
            os.environ["DATA_PACKAGE_PATH"] = self._saved

    def test_root_filtering_terms_payload_shape(self) -> None:
        from fastapi.testclient import TestClient
        from app import app

        client = TestClient(app)
        r = client.get("/filtering_terms")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertIn("meta", body)
        self.assertIn("response", body)
        resp = body["response"]
        self.assertIn("filteringTerms", resp)
        self.assertIn("resources", resp)

        for term in resp["filteringTerms"]:
            self.assertIn("type", term)
            self.assertIn("id", term)
            if "scopes" in term:
                self.assertIsInstance(term["scopes"], list)
                for s in term["scopes"]:
                    self.assertIsInstance(s, str)

        # tissueHigh / tissueSpecific stay match-only (not catalogued).
        tissue_terms = [
            t
            for t in resp["filteringTerms"]
            if str(t.get("id") or "").startswith(("tissueHigh:", "tissueSpecific:"))
        ]
        self.assertEqual(tissue_terms, [])
        # Fixture store has no tissue summary → no Top/Present either.


@unittest.skipUnless(
    HAS_DEMO_PACKAGE and HAS_TISSUE_SUMMARY,
    f"demo package with tissue_feature_summary not found at {DEMO_PACKAGE}",
)
class TissueFiltersDuckDBTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import beacon.fixtures.store as st

        cls._saved = os.environ.get("DATA_PACKAGE_PATH")
        os.environ["DATA_PACKAGE_PATH"] = str(DEMO_PACKAGE)
        st._STORE = None
        from fastapi.testclient import TestClient
        from app import app

        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls) -> None:
        import beacon.fixtures.store as st

        st._STORE = None
        if cls._saved:
            os.environ["DATA_PACKAGE_PATH"] = cls._saved
        else:
            os.environ.pop("DATA_PACKAGE_PATH", None)

    def test_root_catalog_tissue_explore_customs(self) -> None:
        r = self.client.get("/filtering_terms", params={"limit": 0})
        self.assertEqual(r.status_code, 200, r.text)
        by_id = {t["id"]: t for t in r.json()["response"]["filteringTerms"]}
        liver = "UBERON:0002107"
        # tissueHigh / tissueSpecific stay match-only.
        self.assertNotIn(tissue_high_filter_id(liver), by_id)
        pseudo = tissue_high_filter_id(matrix_pseudo_ontology_id("GSE107011"))
        self.assertNotIn(pseudo, by_id)
        # tissueTop / tissuePresent are catalogued for Beacon discovery.
        top = tissue_top_filter_id(liver)
        present = tissue_present_filter_id(liver)
        self.assertIn(top, by_id)
        self.assertIn(present, by_id)
        self.assertEqual(by_id[top].get("type"), "custom")
        self.assertIn("genomicFeature", by_id[top].get("scopes") or [])
        self.assertEqual(by_id[present].get("type"), "custom")
        self.assertIn("genomicFeature", by_id[present].get("scopes") or [])
        # Pseudo matrix columns are not advertised as Top/Present.
        self.assertNotIn(
            tissue_top_filter_id(matrix_pseudo_ontology_id("GSE107011")), by_id
        )
        self.assertNotIn(
            tissue_present_filter_id(matrix_pseudo_ontology_id("GSE107011")), by_id
        )
        # Tissue ontology for Explore sample seeding remains.
        self.assertIn(liver, by_id)

    def test_liver_high_returns_beacon_envelope_with_tissue_bands(self) -> None:
        r = self.client.post(
            "/features",
            json={
                "query": {
                    "filters": [{"id": tissue_high_filter_id("UBERON:0002107")}],
                    "pagination": {"skip": 0, "limit": 5},
                    "requestedGranularity": "record",
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertIn("responseSummary", body)
        results = (
            body.get("response", {}).get("resultSets", [{}])[0].get("results") or []
        )
        if not results:
            self.skipTest("no liver-high features in package")
        for feat in results:
            self.assertNotIn("info", feat)
            self.assertIn("id", feat)
            self.assertIn("featureIdentifier", feat)

    def test_feature_id_list_tissue_top_present_probe(self) -> None:
        """Explore-style probe: featureIDList ∩ tissueTop / tissuePresent, no info."""
        liver = "UBERON:0002107"
        seed = self.client.post(
            "/features",
            json={
                "query": {
                    "filters": [{"id": tissue_present_filter_id(liver)}],
                    "pagination": {"skip": 0, "limit": 5},
                    "requestedGranularity": "record",
                }
            },
        )
        self.assertEqual(seed.status_code, 200, seed.text)
        seed_rows = (
            seed.json()
            .get("response", {})
            .get("resultSets", [{}])[0]
            .get("results")
            or []
        )
        if len(seed_rows) < 2:
            self.skipTest("need ≥2 liver-present features in package")
        ids = [str(row["id"]) for row in seed_rows]
        id_csv = ",".join(ids)

        top = self.client.post(
            "/features",
            json={
                "query": {
                    "filters": [{"id": tissue_top_filter_id(liver)}],
                    "requestParameters": {"featureIDList": id_csv},
                    "pagination": {"skip": 0, "limit": len(ids)},
                    "requestedGranularity": "record",
                }
            },
        )
        present = self.client.post(
            "/features",
            json={
                "query": {
                    "filters": [{"id": tissue_present_filter_id(liver)}],
                    "requestParameters": {"featureIDList": id_csv},
                    "pagination": {"skip": 0, "limit": len(ids)},
                    "requestedGranularity": "record",
                }
            },
        )
        self.assertEqual(top.status_code, 200, top.text)
        self.assertEqual(present.status_code, 200, present.text)
        top_ids = {
            row["id"]
            for row in (
                top.json()
                .get("response", {})
                .get("resultSets", [{}])[0]
                .get("results")
                or []
            )
        }
        present_ids = {
            row["id"]
            for row in (
                present.json()
                .get("response", {})
                .get("resultSets", [{}])[0]
                .get("results")
                or []
            )
        }
        self.assertTrue(present_ids)
        self.assertTrue(top_ids <= present_ids)
        for row in (
            present.json()
            .get("response", {})
            .get("resultSets", [{}])[0]
            .get("results")
            or []
        ):
            self.assertNotIn("info", row)

    def test_tissue_present_page_is_stable_without_info(self) -> None:
        """Gene-row tissuePresent page stays a feature result set, no info bag."""
        body = {
            "query": {
                "filters": [{"id": tissue_present_filter_id("UBERON:0002107")}],
                "pagination": {"skip": 0, "limit": 5},
                "requestedGranularity": "record",
            }
        }
        first = self.client.post("/features", json=body)
        second = self.client.post("/features", json=body)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        body1 = first.json()
        body2 = second.json()
        total1 = body1["responseSummary"]["numTotalResults"]
        total2 = body2["responseSummary"]["numTotalResults"]
        self.assertEqual(total1, total2)
        rows1 = (
            body1.get("response", {}).get("resultSets", [{}])[0].get("results") or []
        )
        rows2 = (
            body2.get("response", {}).get("resultSets", [{}])[0].get("results") or []
        )
        if not rows1:
            self.skipTest("no liver-present features in package")
        self.assertGreater(total1, 0)
        self.assertEqual([row["id"] for row in rows1], [row["id"] for row in rows2])
        self.assertLessEqual(len(rows1), 5)
        for row in rows1:
            self.assertNotIn("info", row)
            self.assertIn("id", row)
            self.assertIn("featureIdentifier", row)

    def test_get_feature_id_list_probe_headers_and_count_skip(self) -> None:
        """GET probe with featureIDList returns Server-Timing; no info bags."""
        liver = "UBERON:0002107"
        seed = self.client.get(
            "/features",
            params={
                "filters": tissue_present_filter_id(liver),
                "skip": 0,
                "limit": 4,
                "requestedGranularity": "record",
            },
        )
        self.assertEqual(seed.status_code, 200, seed.text)
        seed_rows = (
            seed.json()
            .get("response", {})
            .get("resultSets", [{}])[0]
            .get("results")
            or []
        )
        if len(seed_rows) < 2:
            self.skipTest("need ≥2 liver-present features in package")
        ids = [str(row["id"]) for row in seed_rows]
        probe = self.client.get(
            "/features",
            params={
                "filters": tissue_top_filter_id(liver),
                "featureIDList": ",".join(ids),
                "skip": 0,
                "limit": len(ids),
                "requestedGranularity": "record",
            },
        )
        self.assertEqual(probe.status_code, 200, probe.text)
        self.assertIn("server-timing", {k.lower() for k in probe.headers.keys()})
        self.assertIn("etag", {k.lower() for k in probe.headers.keys()})
        body = probe.json()
        total = body["responseSummary"]["numTotalResults"]
        rows = (
            body.get("response", {}).get("resultSets", [{}])[0].get("results") or []
        )
        self.assertLessEqual(total, len(ids))
        self.assertEqual(total, len(rows))
        for row in rows:
            self.assertNotIn("info", row)
            self.assertIn("id", row)


@unittest.skipUnless(
    HAS_DEMO_PACKAGE and HAS_TISSUE_STATS,
    f"demo package with tissue stats not found at {DEMO_PACKAGE}",
)
class TissueRepresentationDuckDBTest(unittest.TestCase):
    def test_per_matrix_column_covers_all_biosamples(self) -> None:
        import duckdb

        con = duckdb.connect(database=":memory:")
        try:
            manifest = __import__("json").loads(
                (DEMO_PACKAGE / "manifest.json").read_text(encoding="utf-8")
            )
            for entry in manifest.get("matrices") or []:
                mid = entry.get("matrix_id")
                dirname = entry.get("dir") or mid
                if not mid:
                    continue
                matrix_dir = DEMO_PACKAGE / "matrices" / str(dirname)
                stats = matrix_dir / "tissue_expression_stats.parquet"
                bios = matrix_dir / "biosamples.parquet"
                if not stats.is_file() or not bios.is_file():
                    continue
                expected = int(
                    con.execute(
                        f"SELECT count(*) FROM read_parquet('{bios.as_posix()}')"
                    ).fetchone()[0]
                )
                got = int(
                    con.execute(
                        f"""
                        SELECT coalesce(sum(n), 0) FROM (
                          SELECT DISTINCT ontology_id, n_biosamples AS n
                          FROM read_parquet('{stats.as_posix()}')
                        )
                        """
                    ).fetchone()[0]
                )
                self.assertEqual(
                    expected,
                    got,
                    msg=f"{mid}: column sum {got} != biosample count {expected}",
                )
        finally:
            con.close()


if __name__ == "__main__":
    unittest.main()
