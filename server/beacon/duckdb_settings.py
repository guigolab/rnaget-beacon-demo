"""DuckDB resource caps for the API process (image has no scripts/ tree)."""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

DEFAULT_MEMORY_LIMIT = "512MB"
DEFAULT_THREADS = 2


def configure_duckdb_connection(
    con: Any,
    *,
    memory_limit: Optional[str] = None,
    threads: Optional[int] = None,
    temp_directory: Optional[str] = None,
) -> None:
    """Apply memory_limit / threads / temp_directory from args or env.

    Env:
      DUCKDB_MEMORY_LIMIT (default 512MB)
      DUCKDB_THREADS (default 2)
      DUCKDB_TEMP_DIR (optional)
    """
    mem = (memory_limit or os.environ.get("DUCKDB_MEMORY_LIMIT") or DEFAULT_MEMORY_LIMIT).strip()
    thr_raw = threads
    if thr_raw is None:
        env_thr = os.environ.get("DUCKDB_THREADS", "").strip()
        thr_raw = int(env_thr) if env_thr else DEFAULT_THREADS
    thr = max(1, int(thr_raw))
    temp = temp_directory
    if temp is None:
        temp = os.environ.get("DUCKDB_TEMP_DIR", "").strip() or None

    mem_sql = mem.replace("'", "''")
    con.execute(f"SET memory_limit='{mem_sql}'")
    con.execute(f"SET threads TO {thr}")
    if temp:
        temp_sql = str(temp).replace("'", "''")
        con.execute(f"SET temp_directory='{temp_sql}'")
    logger.info(
        "DuckDB caps: memory_limit=%s threads=%s temp_directory=%s",
        mem,
        thr,
        temp or "(default)",
    )
