"""PostgreSQL writers for metadata + expression_values."""

from __future__ import annotations

import io
import os
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import psycopg
from psycopg.types.json import Jsonb

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
DDL_PATH = SCRIPTS_DIR / "sql" / "001_schema.sql"

Row = Tuple[str, str, str, str, float]  # id, matrix_id, feature_id, biosample_id, value

DEFAULT_META_BATCH = 2000
DEFAULT_EXPR_BATCH = 50_000


def database_url_from_env() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    host = os.environ.get("POSTGRES_HOST", "localhost")
    port = os.environ.get("POSTGRES_PORT", "5432")
    user = os.environ.get("POSTGRES_USER", "beacon")
    password = os.environ.get("POSTGRES_PASSWORD", "beacon")
    db = os.environ.get("POSTGRES_DB", "rnaget_beacon")
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"


def connect(url: Optional[str] = None):
    return psycopg.connect(url or database_url_from_env())


def ensure_schema(conn) -> None:
    ddl = DDL_PATH.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(ddl)
    conn.commit()


def _feature_native_id(feat: Dict[str, Any]) -> str:
    if feat.get("nativeId"):
        return str(feat["nativeId"])
    gf = feat.get("genomicFeature") or {}
    ident = gf.get("featureIdentifier") or {}
    if ident.get("id"):
        return str(ident["id"])
    return str(feat.get("id", ""))


def _feature_type_text(feature_type: Any) -> Optional[str]:
    """Normalize featureType to a TEXT column value; full object stays in JSONB."""
    if feature_type is None:
        return None
    if isinstance(feature_type, list):
        feature_type = feature_type[0] if feature_type else None
        if feature_type is None:
            return None
    if isinstance(feature_type, dict):
        label = feature_type.get("label") or feature_type.get("id")
        return str(label) if label is not None else None
    return str(feature_type)


def seed_metadata(
    conn,
    *,
    matrix: Dict[str, Any],
    features: List[Dict[str, Any]],
    biosamples: List[Dict[str, Any]],
    batch_size: int = DEFAULT_META_BATCH,
) -> Dict[str, int]:
    """Upsert matrix / features / biosamples and replace membership for matrix_id."""
    matrix_id = matrix["matrixId"]

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO matrices (matrix_id, name, document)
                VALUES (%s, %s, %s)
                ON CONFLICT (matrix_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    document = EXCLUDED.document
                """,
                (matrix_id, matrix.get("name"), Jsonb(matrix)),
            )

            cur.execute(
                "DELETE FROM matrix_features WHERE matrix_id = %s", (matrix_id,)
            )
            cur.execute(
                "DELETE FROM matrix_biosamples WHERE matrix_id = %s", (matrix_id,)
            )

            feat_rows = []
            feat_junction = []
            for feat in features:
                fid = feat["id"]
                native_id = _feature_native_id(feat)
                resource = feat.get("resource")
                ft_text = _feature_type_text(feat.get("featureType"))
                doc = {k: v for k, v in feat.items() if k != "matrixIds"}
                feat_rows.append((fid, native_id, resource, ft_text, Jsonb(doc)))
                feat_junction.append((matrix_id, fid))

            for i in range(0, len(feat_rows), batch_size):
                chunk = feat_rows[i : i + batch_size]
                cur.executemany(
                    """
                    INSERT INTO features (id, native_id, resource, feature_type, document)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        native_id = EXCLUDED.native_id,
                        resource = EXCLUDED.resource,
                        feature_type = EXCLUDED.feature_type,
                        document = EXCLUDED.document
                    """,
                    chunk,
                )
                cur.executemany(
                    """
                    INSERT INTO matrix_features (matrix_id, feature_id)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    feat_junction[i : i + batch_size],
                )

            sample_rows = []
            sample_junction = []
            for sample in biosamples:
                sid = sample.get("id") or sample.get("biosampleId")
                doc = dict(sample)
                doc["id"] = sid
                doc["biosampleId"] = sid
                doc.pop("matrixIds", None)
                sample_rows.append((sid, Jsonb(doc)))
                sample_junction.append((matrix_id, sid))

            for i in range(0, len(sample_rows), batch_size):
                cur.executemany(
                    """
                    INSERT INTO biosamples (id, document)
                    VALUES (%s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        document = EXCLUDED.document
                    """,
                    sample_rows[i : i + batch_size],
                )
                cur.executemany(
                    """
                    INSERT INTO matrix_biosamples (matrix_id, biosample_id)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    sample_junction[i : i + batch_size],
                )

        conn.commit()
    except Exception:
        conn.rollback()
        raise

    return {
        "matrices": 1,
        "features": len(features),
        "biosamples": len(biosamples),
    }


def _row_id(matrix_id: str, feature_id: str, biosample_id: str) -> str:
    return f"{matrix_id}:{feature_id}:{biosample_id}"


def _esc_copy(s: str) -> str:
    return (
        s.replace("\\", "\\\\")
        .replace("\t", "\\t")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    )


def seed_expression_values(
    conn,
    rows: Iterable[Tuple[str, str, str, float]],
    *,
    matrix_id: str,
    batch_size: int = DEFAULT_EXPR_BATCH,
    progress_every: int = 10,
) -> int:
    """Replace all expression rows for matrix_id atomically, then bulk-load.

    Input rows: (matrix_id, feature_id_native, biosample_id, value)

    DELETE + all COPY batches run in one transaction so a mid-seed failure
    rolls back to the previous complete dataset.
    """
    buffer: List[Row] = []
    total = 0
    batches = 0

    def flush(cur, batch: List[Row]) -> None:
        nonlocal total, batches
        if not batch:
            return
        buf = io.StringIO()
        for rid, mid, fid, bid, val in batch:
            buf.write(
                f"{_esc_copy(rid)}\t{_esc_copy(mid)}\t{_esc_copy(fid)}\t"
                f"{_esc_copy(bid)}\t{val}\n"
            )
        buf.seek(0)
        with cur.copy(
            "COPY expression_values (id, matrix_id, feature_id, biosample_id, value) "
            "FROM STDIN"
        ) as copy:
            copy.write(buf.read())
        total += len(batch)
        batches += 1
        if progress_every > 0 and batches % progress_every == 0:
            print(f"  … expression rows loaded: {total}", file=sys.stderr, flush=True)
        batch.clear()

    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM expression_values WHERE matrix_id = %s",
                (matrix_id,),
            )
            for mid, feature_id, biosample_id, value in rows:
                buffer.append(
                    (
                        _row_id(mid, feature_id, biosample_id),
                        mid,
                        feature_id,
                        biosample_id,
                        float(value),
                    )
                )
                if len(buffer) >= batch_size:
                    flush(cur, buffer)
            flush(cur, buffer)
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    return total
