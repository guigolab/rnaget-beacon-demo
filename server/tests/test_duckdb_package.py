"""DuckDBStore coverage for the audit fixes, plus entity/envelope schemas."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

import pyarrow as pa
import pyarrow.parquet as pq

SERVER_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVER_DIR.parent


def _framework_json_dir() -> Path:
    env = os.environ.get("BEACON_FRAMEWORK_JSON", "").strip()
    if env:
        return Path(env)
    return REPO_ROOT / "beacon-schemas" / "framework" / "json"


FRAMEWORK_JSON = _framework_json_dir()
ENVELOPE_SCHEMA = FRAMEWORK_JSON / "responses" / "beaconResultsetsResponse.json"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

_SAVED_DATA_PACKAGE = os.environ.get("DATA_PACKAGE_PATH")


def _write(path: Path, rows: List[Dict[str, Any]], schema: pa.Schema) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pylist(rows, schema=schema) if rows else pa.Table.from_batches([], schema=schema)
    pq.write_table(table, path, compression="zstd")


_TERMS = pa.list_(pa.struct([("id", pa.string()), ("label", pa.string())]))
_STR_LIST = pa.list_(pa.string())
_FEAT_SCHEMA = pa.schema(
    [
        ("feature_id", pa.string()),
        ("wrapper_id", pa.string()),
        ("resource", pa.string()),
        ("symbol", pa.string()),
        ("aliases", _STR_LIST),
        ("xrefs", _STR_LIST),
        ("feature_type_id", pa.string()),
        ("feature_type_label", pa.string()),
        ("ontology_terms", _TERMS),
        ("chrom", pa.string()),
        ("start", pa.int64()),
        ("end", pa.int64()),
        ("strand", pa.string()),
        ("matrix_id", pa.string()),
    ]
)
_BIO_SCHEMA = pa.schema(
    [
        ("biosample_id", pa.string()),
        ("matrix_id", pa.string()),
        ("ontology_id", pa.string()),
        ("ontology_label", pa.string()),
        ("sample_origin_type_id", pa.string()),
        ("sample_origin_type_label", pa.string()),
        ("biosample_status_id", pa.string()),
        ("biosample_status_label", pa.string()),
        ("sex", pa.string()),
        ("rin", pa.float64()),
    ]
)
_EXPR_SCHEMA = pa.schema(
    [
        ("matrix_id", pa.string()),
        ("feature_id", pa.string()),
        ("biosample_id", pa.string()),
        ("value", pa.float64()),
    ]
)
_FEAT_STATS = pa.schema(
    [
        ("feature_id", pa.string()),
        ("min_value", pa.float64()),
        ("max_value", pa.float64()),
        ("min_biosample_id", pa.string()),
        ("max_biosample_id", pa.string()),
    ]
)
_BIO_STATS = pa.schema(
    [
        ("biosample_id", pa.string()),
        ("min_value", pa.float64()),
        ("max_value", pa.float64()),
        ("min_feature_id", pa.string()),
        ("max_feature_id", pa.string()),
    ]
)


def _feature(fid: str, wid: str, matrix_id: str, **extra: Any) -> Dict[str, Any]:
    row = {
        "feature_id": fid,
        "wrapper_id": wid,
        "resource": "gencode",
        "symbol": extra.get("symbol"),
        "aliases": extra.get("aliases") or [],
        "xrefs": extra.get("xrefs") or [],
        "feature_type_id": "SO:0000704",
        "feature_type_label": "gene",
        "ontology_terms": extra.get("ontology_terms") or [],
        "chrom": extra.get("chrom"),
        "start": extra.get("start"),
        "end": extra.get("end"),
        "strand": extra.get("strand"),
        "matrix_id": matrix_id,
    }
    return row


def _biosample(bid: str, matrix_id: str, ontology: str, label: str, sex: str, rin: float) -> Dict[str, Any]:
    return {
        "biosample_id": bid,
        "matrix_id": matrix_id,
        "ontology_id": ontology,
        "ontology_label": label,
        "sample_origin_type_id": "OBI:0001479",
        "sample_origin_type_label": "specimen from organism",
        "biosample_status_id": "EFO:0009654",
        "biosample_status_label": "reference sample",
        "sex": sex,
        "rin": rin,
    }


def _matrix_doc(mid: str, n_feat: int, n_bio: int) -> Dict[str, Any]:
    return {
        "matrixId": mid,
        "name": mid,
        "expressionUnitAndScale": {"unit": "TPM", "scale": "linear"},
        "featureType": [{"id": "SO:0000704", "label": "gene"}],
        "annotation": {
            "source": "gencode",
            "version": "v26",
            "file": "https://example.org/gencode.gtf.gz",
        },
        "assembly": {"accession": "GCA_000001405.15", "name": "GRCh38"},
        "reproducible": True,
        "dimensions": {"features": n_feat, "biosamples": n_bio},
    }


def _build_package(root: Path) -> None:
    tp53 = dict(
        symbol="TP53",
        aliases=["TP53"],
        xrefs=["HGNC:11998"],
        ontology_terms=[{"id": "SO:0001217", "label": "protein_coding_gene"}],
        chrom="chr17",
        start=7661779,
        end=7687550,
        strand="negative",
    )
    gapdh = dict(symbol="GAPDH", aliases=["GAPDH"], chrom="chr12", start=6534512, end=6538374, strand="positive")
    m1_features = [
        _feature("ENSG00000141510.18", "feature-ENSG00000141510.18", "M_DENSE", **tp53),
        _feature("ENSG00000111640.15", "feature-ENSG00000111640.15", "M_DENSE", **gapdh),
    ]
    m2_features = [
        _feature("ENSG00000141510.18", "feature-ENSG00000141510.18", "M_SPARSE", **tp53),
        _feature("ENSG00000111640.15", "feature-ENSG00000111640.15", "M_SPARSE", **gapdh),
        _feature("feature-SHARED", "feature-M2", "M_SPARSE", symbol="SHARED"),
    ]
    m3_features = [
        _feature("ENSG_X", "feature-SHARED", "M_OTHER", symbol="OTHER"),
    ]
    m1_bios = [
        _biosample("B1", "M_DENSE", "UBERON:0000178", "blood", "female", 8.2),
        _biosample("B2", "M_DENSE", "UBERON:0002107", "liver", "male", 5.0),
    ]
    m2_bios = [
        _biosample("B3", "M_SPARSE", "UBERON:0000178", "blood", "female", 9.0),
        _biosample("B4", "M_SPARSE", "UBERON:0002107", "liver", "male", 4.0),
    ]
    m3_bios = [_biosample("B9", "M_OTHER", "UBERON:0000178", "blood", "female", 7.5)]
    # Distinct values so expression_values sort=value / order=desc|asc is testable.
    m1_expr = [
        {
            "matrix_id": "M_DENSE",
            "feature_id": f["feature_id"],
            "biosample_id": b["biosample_id"],
            "value": float(10 * i + j + 1),
        }
        for i, f in enumerate(m1_features)
        for j, b in enumerate(m1_bios)
    ]
    m2_expr = [
        {"matrix_id": "M_SPARSE", "feature_id": "ENSG00000141510.18", "biosample_id": "B3", "value": 3.5}
    ]
    m3_expr = [{"matrix_id": "M_OTHER", "feature_id": "ENSG_X", "biosample_id": "B9", "value": 1.0}]

    # 12×12 dense matrix for both-list densify / axis pagination tests.
    # Top-100 by value (desc) introduces features F00.. and biosamples S00.. in
    # a staggered order so skip=0 and skip=10 yield distinct 10-id windows.
    m_heat_features = [
        _feature(
            f"HEAT-F{i:02d}",
            f"feature-HEAT-F{i:02d}",
            "M_HEAT",
            symbol=f"HF{i:02d}",
            aliases=[f"HF{i:02d}"],
            chrom="chr1",
            start=1000 + i,
            end=1100 + i,
            strand="positive",
        )
        for i in range(12)
    ]
    m_heat_bios = [
        _biosample(
            f"S{i:02d}",
            "M_HEAT",
            "UBERON:0000178",
            "blood",
            "female" if i % 2 == 0 else "male",
            7.0 + (i * 0.01),
        )
        for i in range(12)
    ]
    m_heat_expr: List[Dict[str, Any]] = []
    seen_heat: Set[Tuple[str, str]] = set()
    for rank in range(100):
        fi = rank % 12
        bi = (rank * 5) % 12
        key = (f"HEAT-F{fi:02d}", f"S{bi:02d}")
        if key in seen_heat:
            continue
        seen_heat.add(key)
        m_heat_expr.append(
            {
                "matrix_id": "M_HEAT",
                "feature_id": key[0],
                "biosample_id": key[1],
                "value": float(1000 - rank),
            }
        )
    for fi in range(12):
        for bi in range(12):
            key = (f"HEAT-F{fi:02d}", f"S{bi:02d}")
            if key in seen_heat:
                continue
            seen_heat.add(key)
            m_heat_expr.append(
                {
                    "matrix_id": "M_HEAT",
                    "feature_id": key[0],
                    "biosample_id": key[1],
                    "value": float(-(fi * 12 + bi + 1)),
                }
            )

    for mid, feats, bios, expr in (
        ("M_DENSE", m1_features, m1_bios, m1_expr),
        ("M_SPARSE", m2_features, m2_bios, m2_expr),
        ("M_OTHER", m3_features, m3_bios, m3_expr),
        ("M_HEAT", m_heat_features, m_heat_bios, m_heat_expr),
    ):
        base = root / "matrices" / mid
        _write(base / "features.parquet", feats, _FEAT_SCHEMA)
        _write(base / "biosamples.parquet", bios, _BIO_SCHEMA)
        _write(base / "expression.parquet", expr, _EXPR_SCHEMA)
        _write(
            base / "feature_expression_stats.parquet",
            [
                {
                    "feature_id": row["feature_id"],
                    "min_value": 0.1,
                    "max_value": 2.0,
                    "min_biosample_id": bios[0]["biosample_id"],
                    "max_biosample_id": bios[-1]["biosample_id"],
                }
                for row in feats
            ],
            _FEAT_STATS,
        )
        _write(
            base / "biosample_expression_stats.parquet",
            [
                {
                    "biosample_id": row["biosample_id"],
                    "min_value": 0.1,
                    "max_value": 2.0,
                    "min_feature_id": feats[0]["feature_id"],
                    "max_feature_id": feats[-1]["feature_id"],
                }
                for row in bios
            ],
            _BIO_STATS,
        )

    index_rows = []
    seen = set()
    matrix_links = []
    ontology_rows = []
    for feats in (m1_features, m2_features, m3_features, m_heat_features):
        for row in feats:
            matrix_links.append(
                {
                    "wrapper_id": row["wrapper_id"],
                    "feature_id": row["feature_id"],
                    "matrix_id": row["matrix_id"],
                }
            )
            if row["wrapper_id"] in seen:
                continue
            seen.add(row["wrapper_id"])
            index_rows.append({k: v for k, v in row.items() if k != "matrix_id"})
            ontology_rows.append(
                {
                    "feature_id": row["feature_id"],
                    "wrapper_id": row["wrapper_id"],
                    "ontology_id": "SO:0000704",
                    "ontology_label": "gene",
                    "role": "feature_type",
                }
            )
    _write(root / "feature_index.parquet", index_rows, pa.schema([f for f in _FEAT_SCHEMA if f.name != "matrix_id"]))
    _write(
        root / "feature_matrix.parquet",
        matrix_links,
        pa.schema(
            [
                ("wrapper_id", pa.string()),
                ("feature_id", pa.string()),
                ("matrix_id", pa.string()),
            ]
        ),
    )
    _write(
        root / "feature_ontology.parquet",
        ontology_rows,
        pa.schema(
            [
                ("feature_id", pa.string()),
                ("wrapper_id", pa.string()),
                ("ontology_id", pa.string()),
                ("ontology_label", pa.string()),
                ("role", pa.string()),
            ]
        ),
    )
    global_bios = []
    bio_links = []
    seen_bio = set()
    for bios in (m1_bios, m2_bios, m3_bios, m_heat_bios):
        for row in bios:
            bio_links.append({"biosample_id": row["biosample_id"], "matrix_id": row["matrix_id"]})
            if row["biosample_id"] in seen_bio:
                continue
            seen_bio.add(row["biosample_id"])
            global_bios.append({k: v for k, v in row.items() if k != "matrix_id"})
    _write(
        root / "biosamples.parquet",
        global_bios,
        pa.schema([f for f in _BIO_SCHEMA if f.name != "matrix_id"]),
    )
    _write(
        root / "biosample_matrix.parquet",
        bio_links,
        pa.schema([("biosample_id", pa.string()), ("matrix_id", pa.string())]),
    )
    lookup = [
        {
            "lookup_key": "TP53",
            "lookup_key_norm": "TP53",
            "lookup_kind": "symbol",
            "feature_id": "ENSG00000141510.18",
            "resource": "gencode",
            "annotation_source": "gencode",
            "annotation_version": "v26",
        },
        {
            "lookup_key": "ENSG00000141510.18",
            "lookup_key_norm": "ENSG00000141510.18",
            "lookup_kind": "feature_id",
            "feature_id": "ENSG00000141510.18",
            "resource": "gencode",
            "annotation_source": "gencode",
            "annotation_version": "v26",
        },
    ]
    _write(
        root / "gene_lookup.parquet",
        lookup,
        pa.schema(
            [
                ("lookup_key", pa.string()),
                ("lookup_key_norm", pa.string()),
                ("lookup_kind", pa.string()),
                ("feature_id", pa.string()),
                ("resource", pa.string()),
                ("annotation_source", pa.string()),
                ("annotation_version", pa.string()),
            ]
        ),
    )
    (root / "matrices.json").write_text(
        json.dumps(
            [
                _matrix_doc("M_DENSE", 2, 2),
                _matrix_doc("M_SPARSE", 3, 2),
                _matrix_doc("M_OTHER", 1, 1),
                _matrix_doc("M_HEAT", 12, 12),
            ]
        ),
        encoding="utf-8",
    )
    (root / "manifest.json").write_text(
        json.dumps(
            {
                "schemaVersion": "1",
                "matrices": [
                    {"matrix_id": "M_DENSE", "dir": "M_DENSE", "expressionRows": 4},
                    {"matrix_id": "M_SPARSE", "dir": "M_SPARSE", "expressionRows": 1},
                    {"matrix_id": "M_OTHER", "dir": "M_OTHER", "expressionRows": 1},
                    {
                        "matrix_id": "M_HEAT",
                        "dir": "M_HEAT",
                        "expressionRows": len(m_heat_expr),
                    },
                ],
                "features": {"numUnique": len(index_rows)},
                "biosamples": {"numUnique": len(global_bios)},
            }
        ),
        encoding="utf-8",
    )
    (root / "filtering_terms.json").write_text(
        json.dumps(
            {
                "resources": [
                    {
                        "id": "so",
                        "name": "Sequence Ontology",
                        "nameSpacePrefix": "SO",
                        "iriPrefix": "http://purl.obolibrary.org/obo/SO_",
                        "url": "http://purl.obolibrary.org/obo/so.obo",
                    },
                    {
                        "id": "uberon",
                        "name": "Uberon",
                        "nameSpacePrefix": "UBERON",
                        "iriPrefix": "http://purl.obolibrary.org/obo/UBERON_",
                        "url": "http://purl.obolibrary.org/obo/uberon.owl",
                    },
                    {
                        "id": "symbol",
                        "name": "Gene symbol",
                        "nameSpacePrefix": "symbol",
                        "iriPrefix": "https://www.genenames.org/tools/search/#!/?query=",
                        "url": "https://www.genenames.org",
                    },
                ],
                "filteringTerms": [
                    {"type": "SO", "id": "SO:0000704", "label": "gene", "scopes": ["genomicFeature"]},
                    {
                        "type": "SO",
                        "id": "SO:0001217",
                        "label": "protein_coding_gene",
                        "scopes": ["genomicFeature"],
                    },
                    {
                        "type": "UBERON",
                        "id": "UBERON:0000178",
                        "label": "blood",
                        "scopes": ["biosample"],
                    },
                    {
                        "type": "alphanumeric",
                        "id": "sex",
                        "label": "Sex",
                        "scopes": ["biosample"],
                        "values": ["female", "male"],
                    },
                ],
            }
        ),
        encoding="utf-8",
    )


def _json_pointer(doc: Any, fragment: str) -> Any:
    if not fragment or fragment == "#":
        return doc
    node = doc
    for part in fragment[2:].split("/"):
        if part == "":
            continue
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(node, list):
            node = node[int(part)]
        else:
            node = node[part]
    return node


def _load_ref(ref: str, base: Path) -> Tuple[Any, Path]:
    if ref.startswith("https://w3id.org/"):
        return {"type": "object", "additionalProperties": True}, base
    path_part, _, fragment = ref.partition("#")
    fragment = f"#{fragment}" if fragment else ""
    framework = FRAMEWORK_JSON
    # Default-model common JSON is not vendored; missing refs resolve permissively.
    models = REPO_ROOT / "beacon-schemas" / ".models-placeholder"
    github = "https://raw.githubusercontent.com/ga4gh-beacon/beacon-v2/main/framework/json/"
    named = {
        "measurement.json": models / "measurement.json",
        "procedure.json": models / "procedure.json",
        "phenotypicFeature.json": models / "phenotypicFeature.json",
        "info.json": framework / "common" / "info.json",
        "ontologyTerm.json": framework / "common" / "ontologyTerm.json",
    }
    path: Path | None = None
    if path_part.startswith(github):
        path = framework / path_part[len(github) :]
    elif path_part:
        local = (base / path_part).resolve()
        if local.is_file():
            path = local
        elif Path(path_part).name in named:
            path = named[Path(path_part).name]
    elif fragment:
        same = base / "beaconCommonComponents.json"
        if same.is_file() and fragment.startswith("#/"):
            doc = json.loads(same.read_text(encoding="utf-8"))
            return _json_pointer(doc, fragment), same.parent
        return {"type": "object", "additionalProperties": True}, base
    if path is None or not path.is_file():
        return {"type": "object", "additionalProperties": True}, base
    doc = json.loads(path.read_text(encoding="utf-8"))
    if fragment:
        doc = _json_pointer(doc, fragment)
    return doc, path.parent


def _resolve_schema(schema: Any, base: Path, stack: Tuple[str, ...] = ()) -> Any:
    if isinstance(schema, list):
        return [_resolve_schema(item, base, stack) for item in schema]
    if not isinstance(schema, dict):
        return schema
    ref = schema.get("$ref")
    if isinstance(ref, str):
        key = f"{base}:{ref}"
        if key in stack:
            return {"type": "object", "additionalProperties": True}
        target, target_base = _load_ref(ref, base)
        resolved = _resolve_schema(target, target_base, stack + (key,))
        extra = {
            key_name: _resolve_schema(value, base, stack + (key,))
            for key_name, value in schema.items()
            if key_name != "$ref"
        }
        if extra and isinstance(resolved, dict):
            merged = dict(resolved)
            merged.update(extra)
            return merged
        return resolved
    return {
        key_name: _resolve_schema(value, base, stack)
        for key_name, value in schema.items()
    }


def _validator(schema_path: Path):
    from jsonschema import Draft202012Validator

    raw = json.loads(schema_path.read_text(encoding="utf-8"))
    resolved = _resolve_schema(raw, schema_path.parent)
    return Draft202012Validator(resolved)


class DuckDBPackageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory()
        root = Path(cls._tmp.name)
        _build_package(root)
        os.environ["DATA_PACKAGE_PATH"] = str(root)
        import beacon.fixtures.store as st

        st._STORE = None
        from fastapi.testclient import TestClient
        from app import app

        cls.client = TestClient(app)
        from beacon.fixtures import get_store

        cls.store = get_store()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.close()
        import beacon.fixtures.store as st

        st._STORE = None
        if _SAVED_DATA_PACKAGE:
            os.environ["DATA_PACKAGE_PATH"] = _SAVED_DATA_PACKAGE
        else:
            os.environ.pop("DATA_PACKAGE_PATH", None)
        cls._tmp.cleanup()

    def test_dense_cohort_does_not_500(self) -> None:
        r = self.client.get(
            "/matrices/M_DENSE/features",
            params={"filters": "UBERON:0000178", "limit": 10},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["responseSummary"]["numTotalResults"], 2)

    def test_sparse_cohort_keeps_features_with_values(self) -> None:
        blood = self.client.get(
            "/matrices/M_SPARSE/features",
            params={"filters": "UBERON:0000178", "limit": 10},
        )
        self.assertEqual(blood.status_code, 200, blood.text)
        ids = {
            row["genomicFeature"]["featureIdentifier"]["id"]
            for row in blood.json()["response"]["resultSets"][0]["results"]
        }
        self.assertEqual(ids, {"ENSG00000141510.18"})
        liver = self.client.get(
            "/matrices/M_SPARSE/features",
            params={"filters": "UBERON:0002107", "limit": 10},
        )
        self.assertEqual(liver.status_code, 200, liver.text)
        self.assertEqual(liver.json()["responseSummary"]["numTotalResults"], 0)

    def test_feature_list_skip_is_not_capped_at_100k(self) -> None:
        r = self.client.get("/features", params={"skip": 100001, "limit": 1})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertGreaterEqual(body["responseSummary"]["numTotalResults"], 4)
        self.assertEqual(body["response"]["resultSets"][0]["results"], [])

    def test_expression_skip_stays_capped(self) -> None:
        r = self.client.get(
            "/matrices/M_DENSE/expression_values",
            params={"skip": 100001, "limit": 1},
        )
        self.assertEqual(r.status_code, 400, r.text)
        self.assertIn("skip", r.json()["error"]["errorMessage"])

    def test_limit_zero_maps_to_server_cap(self) -> None:
        r = self.client.get("/biosamples", params={"limit": 0})
        self.assertEqual(r.status_code, 200, r.text)
        summary = r.json()["meta"]["receivedRequestSummary"]
        self.assertEqual(summary["pagination"]["limit"], 1000)
        self.assertGreaterEqual(r.json()["responseSummary"]["numTotalResults"], 1)

    def test_include_resultset_responses(self) -> None:
        hit = self.client.post(
            "/features/does-not-exist",
            json={"query": {"includeResultsetResponses": "HIT", "requestedGranularity": "record"}},
        )
        self.assertEqual(hit.status_code, 200, hit.text)
        self.assertEqual(hit.json()["response"]["resultSets"], [])
        self.assertEqual(
            hit.json()["meta"]["receivedRequestSummary"]["includeResultsetResponses"],
            "HIT",
        )
        none = self.client.post(
            "/features",
            json={
                "query": {
                    "includeResultsetResponses": "NONE",
                    "pagination": {"limit": 5},
                }
            },
        )
        self.assertEqual(none.status_code, 200, none.text)
        self.assertEqual(none.json()["response"]["resultSets"], [])

    def test_numeric_alphanumeric_filter(self) -> None:
        r = self.client.post(
            "/biosamples",
            json={"query": {"filters": [{"id": "rin", "operator": ">", "value": 7}]}},
        )
        self.assertEqual(r.status_code, 200, r.text)
        ids = {row["id"] for row in r.json()["response"]["resultSets"][0]["results"]}
        self.assertIn("B1", ids)
        self.assertNotIn("B2", ids)
        echoed = r.json()["meta"]["receivedRequestSummary"]["filters"]
        self.assertIsInstance(echoed, list)
        self.assertEqual(echoed[0]["id"], "rin")
        via_get = self.client.get("/biosamples", params={"filters": "rin:>=:7", "limit": 10})
        self.assertEqual(via_get.status_code, 200, via_get.text)
        get_ids = {row["id"] for row in via_get.json()["response"]["resultSets"][0]["results"]}
        self.assertIn("B1", get_ids)
        self.assertNotIn("B2", get_ids)

    def test_ontology_filter_echoes_exact_match(self) -> None:
        r = self.client.get("/biosamples", params={"filters": "UBERON:0000178", "limit": 5})
        self.assertEqual(r.status_code, 200, r.text)
        echoed = r.json()["meta"]["receivedRequestSummary"]["filters"]
        self.assertEqual(echoed[0]["id"], "UBERON:0000178")
        self.assertIs(echoed[0]["includeDescendantTerms"], False)
        self.assertNotIn("filters", echoed[0])

    def test_error_envelopes_for_unknown_route_and_method(self) -> None:
        missing = self.client.get("/nope")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()["error"]["errorCode"], 404)
        self.assertIn("beaconId", missing.json()["meta"])
        method = self.client.delete("/biosamples")
        self.assertEqual(method.status_code, 405)
        self.assertEqual(method.json()["error"]["errorCode"], 405)

    def test_service_info_is_ga4gh_document(self) -> None:
        body = self.client.get("/service-info").json()
        for key in ("id", "name", "type", "organization", "version"):
            self.assertIn(key, body)
        self.assertEqual(body["organization"]["url"], "https://www.crg.eu")
        self.assertNotIn("meta", body)

    def test_sparse_matrix_is_not_treated_as_dense_without_a_row_count(self) -> None:
        self.store._manifest_expr_rows.pop("M_SPARSE", None)
        self.store._dense_cache.pop("M_SPARSE", None)
        try:
            self.assertFalse(self.store._matrix_expression_is_dense("M_SPARSE"))
        finally:
            self.store._manifest_expr_rows["M_SPARSE"] = 1
            self.store._dense_cache.pop("M_SPARSE", None)

    def test_full_biosample_cohort_keeps_expression_rows(self) -> None:
        response = self.client.get(
            "/matrices/M_DENSE/expression_values",
            params={"biosampleIDList": "B1,B2", "limit": 1},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["responseSummary"]["numTotalResults"], 4)

    def test_expression_values_sort_by_value_order(self) -> None:
        desc = self.client.get(
            "/matrices/M_DENSE/expression_values",
            params={
                "biosampleIDList": "B1",
                "limit": 10,
                "sort": "value",
                "order": "desc",
            },
        )
        self.assertEqual(desc.status_code, 200, desc.text)
        body = desc.json()
        rp = body["meta"]["receivedRequestSummary"]["requestParameters"]
        self.assertEqual(rp["sort"], "value")
        self.assertEqual(rp["order"], "desc")
        values = [
            row["value"]
            for row in body["response"]["resultSets"][0]["results"]
        ]
        self.assertEqual(values, sorted(values, reverse=True))
        self.assertGreater(values[0], values[-1])

        asc = self.client.get(
            "/matrices/M_DENSE/expression_values",
            params={
                "biosampleIDList": "B1",
                "limit": 10,
                "sort": "value",
                "order": "asc",
            },
        )
        self.assertEqual(asc.status_code, 200, asc.text)
        asc_values = [
            row["value"]
            for row in asc.json()["response"]["resultSets"][0]["results"]
        ]
        self.assertEqual(asc_values, sorted(asc_values))
        self.assertEqual(asc_values, list(reversed(values)))

        # ``sort`` defaults to ``id`` (feature_id, biosample_id) when omitted.
        default_sort = self.client.get(
            "/matrices/M_DENSE/expression_values",
            params={"biosampleIDList": "B1", "limit": 10},
        )
        self.assertEqual(default_sort.status_code, 200, default_sort.text)
        default_body = default_sort.json()
        self.assertEqual(
            default_body["meta"]["receivedRequestSummary"]["requestParameters"][
                "sort"
            ],
            "id",
        )
        default_rows = default_body["response"]["resultSets"][0]["results"]
        default_ids = [(row["featureId"], row["biosampleId"]) for row in default_rows]
        self.assertEqual(default_ids, sorted(default_ids))

        # Only "id" / "value" are accepted sort keys (FastAPI enum validation,
        # surfaced as a Beacon-shaped 400 error by this server's handlers).
        rejected = self.client.get(
            "/matrices/M_DENSE/expression_values",
            params={"sort": "expression.min", "limit": 1},
        )
        self.assertEqual(rejected.status_code, 400, rejected.text)

    def test_expression_values_id_lists_are_not_capped(self) -> None:
        """The former 20/10 one-sided-list caps and combined-rank ordering
        were removed: ID-list queries are now plain intersection filters with
        no special page-size cap and no caps helper override.
        """
        from beacon.duckdb_store import apply_expression_values_limit_cap

        # The (deprecated) cap helper is now a no-op clamp only.
        self.assertEqual(apply_expression_values_limit_cap(100, "TP53", None), 100)
        self.assertEqual(
            apply_expression_values_limit_cap(100, None, "B1,B2,B3"), 100
        )
        self.assertEqual(
            apply_expression_values_limit_cap(100, "TP53,GAPDH", "B1,B2"), 100
        )

        single_feature = self.client.get(
            "/matrices/M_DENSE/expression_values",
            params={"featureIDList": "ENSG00000141510.18", "limit": 50},
        )
        self.assertEqual(single_feature.status_code, 200, single_feature.text)
        self.assertEqual(
            len(single_feature.json()["response"]["resultSets"][0]["results"]), 2
        )

        tp53 = "ENSG00000141510.18"
        gapdh = "ENSG00000111640.15"
        combined = self.client.get(
            "/matrices/M_DENSE/expression_values",
            params={
                "featureIDList": f"{tp53},{gapdh}",
                "biosampleIDList": "B1,B2",
                "limit": 10,
                "order": "asc",
            },
        )
        self.assertEqual(combined.status_code, 200, combined.text)
        pairs = [
            (row["featureId"], row["biosampleId"])
            for row in combined.json()["response"]["resultSets"][0]["results"]
        ]
        self.assertEqual(len(pairs), 4)
        self.assertEqual(set(pairs), {(tp53, "B1"), (tp53, "B2"), (gapdh, "B1"), (gapdh, "B2")})
        # Flat expressionValue shape unchanged.
        row0 = combined.json()["response"]["resultSets"][0]["results"][0]
        self.assertEqual(
            set(row0),
            {"id", "matrixId", "featureId", "biosampleId", "value"},
        )

        # Explicit both-lists path densifies the feature×biosample product.
        densified = self.client.get(
            "/matrices/M_HEAT/expression_values",
            params={
                "featureIDList": ",".join(f"HEAT-F{i:02d}" for i in range(10)),
                "biosampleIDList": ",".join(f"S{i:02d}" for i in range(10)),
                "limit": 100,
                "order": "asc",
            },
        )
        self.assertEqual(densified.status_code, 200, densified.text)
        dense_body = densified.json()
        dense_rows = dense_body["response"]["resultSets"][0]["results"]
        self.assertEqual(len(dense_rows), 100)
        axes = dense_body["info"]["axes"]
        self.assertEqual(len(axes["featureIds"]), 10)
        self.assertEqual(len(axes["biosampleIds"]), 10)
        pair_set = {(r["featureId"], r["biosampleId"]) for r in dense_rows}
        self.assertEqual(len(pair_set), 100)

    def test_expression_values_info_axes(self) -> None:
        response = self.client.get(
            "/matrices/M_DENSE/expression_values",
            params={"limit": 10, "order": "desc"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        results = body["response"]["resultSets"][0]["results"]
        self.assertTrue(results)
        axes = body["info"]["axes"]
        feature_ids = axes["featureIds"]
        biosample_ids = axes["biosampleIds"]
        self.assertEqual(
            feature_ids,
            list(dict.fromkeys(row["featureId"] for row in results)),
        )
        self.assertEqual(
            biosample_ids,
            list(dict.fromkeys(row["biosampleId"] for row in results)),
        )
        # Once per response — not on each cell.
        for row in results:
            self.assertNotIn("axes", row)
            self.assertNotIn("info", row)

        count = self.client.get(
            "/matrices/M_DENSE/expression_values",
            params={"limit": 10, "requestedGranularity": "count"},
        )
        self.assertEqual(count.status_code, 200, count.text)
        self.assertNotIn("info", count.json())

    def test_feature_id_resolution_is_matrix_scoped(self) -> None:
        resolved = self.store._resolve_feature_filter_ids("feature-SHARED", "M_SPARSE")
        self.assertIn("feature-SHARED", resolved)
        self.assertNotIn("ENSG_X", resolved)

    def test_genomic_interval_and_no_leaked_biosample_fields(self) -> None:
        feature = self.client.get("/features/feature-ENSG00000141510.18").json()
        row = feature["response"]["resultSets"][0]["results"][0]
        interval = row["genomicFeature"]["genomicInterval"]
        self.assertEqual(interval["location"]["sequence_id"], "refseq:NC_000017.11")
        self.assertEqual(
            feature["meta"]["apiVersion"],
            feature["meta"]["receivedRequestSummary"]["apiVersion"],
        )
        self.assertTrue(feature["meta"]["apiVersion"].startswith("v"))
        bio = self.client.get("/biosamples/B1").json()["response"]["resultSets"][0]["results"][0]
        self.assertNotIn("ontology_source", bio)
        self.assertNotIn("sex", bio)
        self.assertEqual(bio["info"]["sex"], "female")

    def test_axis_filtering_terms_cover_ontology(self) -> None:
        r = self.client.get("/matrices/M_DENSE/filtering_terms")
        self.assertEqual(r.status_code, 200, r.text)
        ids = {term["id"] for term in r.json()["response"]["filteringTerms"]}
        self.assertIn("SO:0001217", ids)

    def test_parallel_reads(self) -> None:
        errors: List[str] = []

        def _hit() -> None:
            response = self.client.get(
                "/matrices/M_DENSE/expression_values",
                params={"limit": 2, "minValue": 0},
            )
            if response.status_code != 200:
                errors.append(response.text)

        threads = [threading.Thread(target=_hit) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])

    def test_entity_and_envelope_schemas(self) -> None:
        from jsonschema.exceptions import ValidationError

        feature = self.client.get("/features/feature-ENSG00000141510.18").json()
        biosample = self.client.get("/biosamples/B1").json()
        values = self.client.get(
            "/matrices/M_DENSE/expression_values", params={"limit": 1, "featureIDList": "TP53"}
        ).json()
        schemas = REPO_ROOT / "beacon-schemas"
        cases = [
            (feature["response"]["resultSets"][0]["results"][0], schemas / "genomicFeatureWrapper.json"),
            (biosample["response"]["resultSets"][0]["results"][0], schemas / "biosample.json"),
            (values["response"]["resultSets"][0]["results"][0], schemas / "expressionValue.json"),
        ]
        for doc, path in cases:
            try:
                _validator(path).validate(doc)
            except ValidationError as exc:
                self.fail(f"{path.name}: {exc.message}")
        if not ENVELOPE_SCHEMA.is_file():
            self.fail(
                f"Missing envelope schema at {ENVELOPE_SCHEMA} "
                "(commit beacon-schemas/framework/json from ga4gh-beacon/beacon-v2)"
            )
        try:
            _validator(ENVELOPE_SCHEMA).validate(feature)
        except ValidationError as exc:
            self.fail(f"beaconResultsetsResponse: {exc.message}")


class FeatureAliasOrderTest(unittest.TestCase):
    def test_symbol_is_first_alias(self) -> None:
        from beacon.duckdb_store import DuckDBStore

        doc = DuckDBStore._feature_doc_from_row(
            {
                "feature_id": "ENSG00000198886.2",
                "wrapper_id": "feature-ENSG00000198886.2",
                "resource": "gencode",
                "symbol": "MT-ND4",
                "aliases": ["ENSG00000198886", "MT-ND4"],
            },
            ["GTEx-v8-Liver"],
        )
        self.assertEqual(
            doc["genomicFeature"]["aliases"],
            ["MT-ND4", "ENSG00000198886"],
        )


class FeatureIndexMergeTest(unittest.TestCase):
    def test_newer_blank_symbol_keeps_the_older_symbol(self) -> None:
        scripts = str(REPO_ROOT / "scripts")
        if scripts not in sys.path:
            sys.path.insert(0, scripts)
        from build_feature_indexes import _merge_feature_index_row

        older = {
            "feature_id": "ENSG1",
            "symbol": "TP53",
            "aliases": ["TP53"],
            "xrefs": ["HGNC:1"],
            "ontology_terms": [{"id": "SO:0001217", "label": "protein_coding_gene"}],
            "chrom": "chr17",
            "_ann_rank": (24,),
        }
        newer = {
            "feature_id": "ENSG1",
            "symbol": None,
            "aliases": ["P53"],
            "xrefs": ["NCBIGene:7157"],
            "ontology_terms": [],
            "chrom": "chr17",
            "_ann_rank": (26,),
        }
        merged = _merge_feature_index_row(older, newer)
        self.assertEqual(merged["symbol"], "TP53")
        self.assertEqual(merged["aliases"], ["TP53", "P53"])
        self.assertEqual(merged["xrefs"], ["HGNC:1", "NCBIGene:7157"])
        self.assertEqual(merged["ontology_terms"][0]["id"], "SO:0001217")
        self.assertEqual(merged["_ann_rank"], (26,))


class BuiltPackageSmokeTest(unittest.TestCase):
    """Runs in CI when RNAGET_BUILT_PACKAGE points at the workflow output."""

    def test_built_package_answers(self) -> None:
        raw = os.environ.get("RNAGET_BUILT_PACKAGE", "").strip()
        if not raw:
            self.skipTest("RNAGET_BUILT_PACKAGE is not set")
        package = Path(raw)
        if not (package / "manifest.json").is_file():
            self.skipTest(f"no manifest at {package}")
        previous = os.environ.get("DATA_PACKAGE_PATH")
        os.environ["DATA_PACKAGE_PATH"] = str(package)
        import beacon.fixtures.store as st

        st._STORE = None
        try:
            from fastapi.testclient import TestClient
            from app import app

            client = TestClient(app)
            matrices = client.get("/matrices")
            self.assertEqual(matrices.status_code, 200, matrices.text)
            self.assertGreater(matrices.json()["responseSummary"]["numTotalResults"], 0)
            mid = matrices.json()["response"]["resultSets"][0]["results"][0]["matrixId"]
            features = client.get(f"/matrices/{mid}/features", params={"limit": 1, "filters": "UBERON:0000178"})
            self.assertEqual(features.status_code, 200, features.text)
            info = client.get("/service-info")
            self.assertEqual(info.status_code, 200, info.text)
            self.assertEqual(info.json()["type"]["artifact"], "beacon")
            client.close()
        finally:
            st._STORE = None
            if previous is None:
                os.environ.pop("DATA_PACKAGE_PATH", None)
            else:
                os.environ["DATA_PACKAGE_PATH"] = previous


if __name__ == "__main__":
    unittest.main()
