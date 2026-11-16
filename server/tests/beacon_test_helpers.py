"""Shared constants for Beacon POST bodies in server tests."""

from __future__ import annotations

from typing import Any, Dict

# Matches server BEACON_API_VERSION default / beaconRequestMeta.apiVersion.
BEACON_META: Dict[str, str] = {"apiVersion": "v2.0.0"}


def with_meta(body: Dict[str, Any]) -> Dict[str, Any]:
    """Return a Beacon POST body with required ``meta`` merged in."""
    out = dict(body)
    out.setdefault("meta", dict(BEACON_META))
    return out
