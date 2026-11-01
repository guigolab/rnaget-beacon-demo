"""Regression: ENCODE-style features must not use PyArrow null type for symbol."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from export_parquet import _features_export_schema, _write_table  # noqa: E402


def _encode_like_feature_rows() -> list[dict]:
    return [
        {
            "feature_id": "ENSG00000141510.16",
            "wrapper_id": "feature-1",
            "resource": "https://example.org/g/1",
            "symbol": None,
            "aliases": ["ENSG00000141510"],
            "feature_type_id": "SO:0000704",
            "feature_type_label": "gene",
            "matrix_id": "ENCSR622FSM",
        },
        {
            "feature_id": "ENSG00000157764.15",
            "wrapper_id": "feature-2",
            "resource": "https://example.org/g/2",
            "symbol": None,
            "aliases": ["ENSG00000157764"],
            "feature_type_id": "SO:0000704",
            "feature_type_label": "gene",
            "matrix_id": "ENCSR622FSM",
        },
    ]


def _cast_features_like_hydrate(orig_schema: pa.Schema, rows: list[dict]) -> pa.Table:
    """Mirror hydrate_genes features.parquet rewrite cast loop."""
    out_table = pa.Table.from_pylist(rows)
    for field in orig_schema:
        if field.name not in out_table.column_names:
            continue
        if pa.types.is_null(field.type):
            continue
        idx = out_table.schema.get_field_index(field.name)
        cast_col = out_table.column(idx).cast(field.type, safe=False)
        out_table = out_table.set_column(idx, field, cast_col)
    return out_table


class FeaturesSymbolSchemaTest(unittest.TestCase):
    def test_export_features_symbol_is_string_not_null_type(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "features.parquet"
            _write_table(
                path,
                _encode_like_feature_rows(),
                schema=_features_export_schema(),
            )
            table = pq.read_table(path)
            sym_field = table.schema.field("symbol")
            self.assertEqual(sym_field.type, pa.string())
            self.assertIsNone(table.column("symbol")[0].as_py())

    def test_hydrate_rewrite_survives_legacy_null_symbol_column(self) -> None:
        rows = _encode_like_feature_rows()
        legacy = pa.Table.from_pylist(rows)
        self.assertEqual(legacy.schema.field("symbol").type, pa.null())

        rows[0]["symbol"] = "TP53"
        out = _cast_features_like_hydrate(legacy.schema, rows)
        self.assertEqual(out.schema.field("symbol").type, pa.string())
        self.assertEqual(out.column("symbol")[0].as_py(), "TP53")

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "features.parquet"
            pq.write_table(out, path, compression="zstd")
            reread = pq.read_table(path)
            self.assertEqual(reread.schema.field("symbol").type, pa.string())


if __name__ == "__main__":
    unittest.main()
