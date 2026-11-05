"""DuckDB resource caps for the API process (image has no scripts/ tree)."""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

DEFAULT_MEMORY_LIMIT = "1GB"
DEFAULT_THREADS = 2


def configure_duckdb_connection(
    con: Any,
    *,
    memory_limit: Optional[str] = None,
    threads: Optional[int] = None,
    temp_directory: Optional[str] = None,
) -> None:
    """Apply memory_limit / threads and disable temp-file spill.

    Env:
      DUCKDB_MEMORY_LIMIT (default 1GB)
      DUCKDB_THREADS (default 2)

    ``temp_directory`` and ``DUCKDB_TEMP_DIR`` are ignored on the API path so
    queries that do not fit in memory fail instead of writing spill files.
    """
    mem = (memory_limit or os.environ.get("DUCKDB_MEMORY_LIMIT") or DEFAULT_MEMORY_LIMIT).strip()
    thr_raw = threads
    if thr_raw is None:
        env_thr = os.environ.get("DUCKDB_THREADS", "").strip()
        thr_raw = int(env_thr) if env_thr else DEFAULT_THREADS
    thr = max(1, int(thr_raw))
    # Spill is disabled: ignore temp_directory / DUCKDB_TEMP_DIR on the API path.
    _ = temp_directory

    mem_sql = mem.replace("'", "''")
    con.execute(f"SET memory_limit='{mem_sql}'")
    con.execute(f"SET threads TO {thr}")
    # '0B' disables spill; bare '0' is a parser error in DuckDB.
    con.execute("SET max_temp_directory_size='0B'")
    logger.info(
        "DuckDB caps: memory_limit=%s threads=%s max_temp_directory_size=0B",
        mem,
        thr,
    )
