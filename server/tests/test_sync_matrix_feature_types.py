"""Package sync: biotype projection, id/source, info/package removal."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def _write(path: Path, sql: str) -> None:
    import duckdb

    con = duckdb.connect()
    con.execute(f"copy ({sql}) to '{path}' (format parquet)")
    con.close()


class SyncMatrixFeatureTypesTest(unittest.TestCase):
    def test_projection_source_and_legacy_bags(self) -> None:
        import duckdb
        from sync_matrix_feature_types import matrices_need_catalog_sync, sync_package

        with tempfile.TemporaryDirectory() as tmp:
            pkg = Path(tmp)
            mdir = pkg / "matrices" / "M1"
            mdir.mkdir(parents=True)
            _write(
                pkg / "genes.parquet",
                "select '1' feature_id, 'ncbigene' resource, 'SO:0001217' biotype_id, "
                "'protein_coding_gene' biotype_label",
            )
            _write(
                mdir / "features.parquet",
                "select '1' feature_id, 'ncbigene' resource, 'SO:0000704' feature_type_id, "
                "'gene' feature_type_label union all "
                "select '2', 'ncbigene', 'SO:0000704', 'gene'",
            )
            _write(
                mdir / "biosamples.parquet",
                "select 'B1' id, 'UBERON:1' ontology_id, 'x' ontology_label",
            )
            (pkg / "manifest.json").write_text(
                json.dumps({"matrices": [{"matrix_id": "M1", "dir": "M1", "source": "geo"}]})
            )
            (pkg / "matrices.json").write_text(
                json.dumps([{"matrixId": "M1", "info": {"a": 1}, "package": {"b": 2}}])
            )
            self.assertTrue(matrices_need_catalog_sync(pkg))
            sync_package(pkg)
            doc = json.loads((pkg / "matrices.json").read_text())[0]
            self.assertEqual(doc["id"], "M1")
            self.assertEqual(doc["source"], "geo")
            self.assertNotIn("info", doc)
            self.assertNotIn("package", doc)
            self.assertEqual(doc["biotypes"], [{"id": "SO:0001217", "label": "protein_coding_gene"}])
            rows = duckdb.connect().execute(
                f"select feature_id, biotype_id from '{mdir / 'features.parquet'}' order by 1"
            ).fetchall()
            self.assertEqual(rows, [("1", "SO:0001217"), ("2", None)])
            # Settled package is not flagged again.
            self.assertFalse(matrices_need_catalog_sync(pkg))


if __name__ == "__main__":
    unittest.main()
