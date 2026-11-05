"""Cache-Control / ETag / Server-Timing helpers for Beacon responses."""

from __future__ import annotations

import hashlib
import time
from typing import Any, Dict, Mapping, MutableMapping, Optional

from fastapi.responses import JSONResponse


def package_etag(package_fingerprint: str) -> str:
    digest = hashlib.sha256(package_fingerprint.encode("utf-8")).hexdigest()[:16]
    return f'W/"{digest}"'


def timing_header(timings_ms: Mapping[str, float]) -> str:
    parts = []
    for name, dur in timings_ms.items():
        if not name:
            continue
        parts.append(f"{name};dur={float(dur):.1f}")
    return ", ".join(parts)


def json_with_headers(
    body: Dict[str, Any],
    *,
    etag: Optional[str] = None,
    cache_control: Optional[str] = None,
    timings_ms: Optional[Mapping[str, float]] = None,
    status_code: int = 200,
) -> JSONResponse:
    headers: Dict[str, str] = {}
    if etag:
        headers["ETag"] = etag
    if cache_control:
        headers["Cache-Control"] = cache_control
    if timings_ms:
        headers["Server-Timing"] = timing_header(timings_ms)
    return JSONResponse(content=body, status_code=status_code, headers=headers)


class RequestTimer:
    """Collect named durations in milliseconds for Server-Timing."""

    def __init__(self) -> None:
        self._marks: MutableMapping[str, float] = {}
        self._t0 = time.perf_counter()

    def mark(self, name: str) -> None:
        now = time.perf_counter()
        self._marks[name] = (now - self._t0) * 1000.0

    def finish(self) -> Dict[str, float]:
        self.mark("total")
        return dict(self._marks)
