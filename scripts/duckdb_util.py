"""Shared DuckDB connection resource caps (merge / stats / tooling)."""

from __future__ import annotations

import os
from typing import Any, Optional


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

    # Quote memory_limit as a string setting.
    mem_sql = mem.replace("'", "''")
    con.execute(f"SET memory_limit='{mem_sql}'")
    con.execute(f"SET threads TO {thr}")
    if temp:
        temp_sql = str(temp).replace("'", "''")
        con.execute(f"SET temp_directory='{temp_sql}'")


def connect_duckdb(database: str = ":memory:", **kwargs: Any) -> Any:
    """Open DuckDB and apply resource caps."""
    import duckdb

    con = duckdb.connect(database=database, **kwargs)
    configure_duckdb_connection(con)
    return con
