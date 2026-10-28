import json
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter

from beacon import config
from beacon.responses import build_filtering_terms_response, build_informational_response

router = APIRouter(tags=["Informational endpoints"])

_FIXTURES = Path(__file__).resolve().parents[1] / "beacon" / "fixtures" / "data"


def _rewrite_urls(obj: Any) -> Any:
    placeholder = "https://exampleBeacons.org"
    if isinstance(obj, dict):
        return {k: _rewrite_urls(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_rewrite_urls(v) for v in obj]
    if isinstance(obj, str) and obj.startswith(placeholder):
        return obj.replace(placeholder, config.BASE_URL, 1)
    return obj


def _load_fixture(name: str) -> Dict[str, Any]:
    path = _FIXTURES / name
    with path.open(encoding="utf-8") as fh:
        return _rewrite_urls(json.load(fh))


def _info_body() -> Dict[str, Any]:
    return {
        "id": config.BEACON_ID,
        "name": config.BEACON_NAME,
        "apiVersion": config.API_VERSION,
        "environment": config.BEACON_ENVIRONMENT,
        "description": config.BEACON_DESCRIPTION,
        "organization": config.ORGANIZATION,
    }


@router.get("/")
@router.get("/info")
def get_info():
    return build_informational_response(
        entity_type="info",
        schema_key="info",
        response_body=_info_body(),
    )


@router.get("/configuration")
def get_configuration():
    return build_informational_response(
        entity_type="configuration",
        schema_key="configuration",
        response_body=_load_fixture("beaconConfiguration.json"),
    )


@router.get("/map")
def get_map():
    return build_informational_response(
        entity_type="map",
        schema_key="map",
        response_body=_load_fixture("beaconMap.json"),
    )


@router.get("/entry_types")
def get_entry_types():
    cfg = _load_fixture("beaconConfiguration.json")
    return build_informational_response(
        entity_type="entryType",
        schema_key="entryTypes",
        response_body={"entryTypes": cfg.get("entryTypes") or {}},
    )


@router.get("/filtering_terms")
@router.post("/filtering_terms")
def filtering_terms():
    return build_filtering_terms_response([])
