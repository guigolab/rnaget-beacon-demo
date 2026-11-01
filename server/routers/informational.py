import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter

from beacon import config
from beacon.responses import build_filtering_terms_response, build_informational_response
from beacon.schemas.envelopes import (
    OPENAPI_FILTERING_TERMS_RESPONSES,
    OPENAPI_INFORMATIONAL_RESPONSES,
)

router = APIRouter(tags=["Informational endpoints"])

_FIXTURES = Path(__file__).resolve().parents[1] / "beacon" / "fixtures" / "data"


def _rewrite_urls(obj: Any, base_url: str) -> Any:
    placeholder = "https://exampleBeacons.org"
    if isinstance(obj, dict):
        return {k: _rewrite_urls(v, base_url) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_rewrite_urls(v, base_url) for v in obj]
    if isinstance(obj, str) and obj.startswith(placeholder):
        return obj.replace(placeholder, base_url, 1)
    return obj


@lru_cache(maxsize=32)
def _load_fixture_cached(name: str, base_url: str) -> Dict[str, Any]:
    path = _FIXTURES / name
    with path.open(encoding="utf-8") as fh:
        return _rewrite_urls(json.load(fh), base_url)


def _load_fixture(name: str) -> Dict[str, Any]:
    return _load_fixture_cached(name, config.BASE_URL)


def _info_body() -> Dict[str, Any]:
    return {
        "id": config.BEACON_ID,
        "name": config.BEACON_NAME,
        "apiVersion": config.API_VERSION,
        "environment": config.BEACON_ENVIRONMENT,
        "description": config.BEACON_DESCRIPTION,
        "organization": config.ORGANIZATION,
    }


@router.get("/", responses=OPENAPI_INFORMATIONAL_RESPONSES)
@router.get("/info", responses=OPENAPI_INFORMATIONAL_RESPONSES)
def get_info():
    return build_informational_response(
        entity_type="info",
        schema_key="info",
        response_body=_info_body(),
    )


@router.get("/service-info", responses=OPENAPI_INFORMATIONAL_RESPONSES)
def get_service_info():
    return build_informational_response(
        entity_type="info",
        schema_key="info",
        response_body={
            "id": config.BEACON_ID,
            "name": config.BEACON_NAME,
            "type": {"group": "org.ga4gh", "artifact": "beacon", "version": "2.0.0"},
            "description": config.BEACON_DESCRIPTION,
            "organization": config.ORGANIZATION,
            "version": config.API_VERSION,
        },
    )


@router.get("/configuration", responses=OPENAPI_INFORMATIONAL_RESPONSES)
def get_configuration():
    return build_informational_response(
        entity_type="configuration",
        schema_key="configuration",
        response_body=_load_fixture("beaconConfiguration.json"),
    )


@router.get("/map", responses=OPENAPI_INFORMATIONAL_RESPONSES)
def get_map():
    return build_informational_response(
        entity_type="map",
        schema_key="map",
        response_body=_load_fixture("beaconMap.json"),
    )


@router.get("/entry_types", responses=OPENAPI_INFORMATIONAL_RESPONSES)
def get_entry_types():
    cfg = _load_fixture("beaconConfiguration.json")
    return build_informational_response(
        entity_type="entryType",
        schema_key="entryTypes",
        response_body={"entryTypes": cfg.get("entryTypes") or {}},
    )


@router.get("/filtering_terms", responses=OPENAPI_FILTERING_TERMS_RESPONSES)
@router.post("/filtering_terms", responses=OPENAPI_FILTERING_TERMS_RESPONSES)
def filtering_terms():
    from beacon.fixtures import get_store

    terms, resources = get_store().filtering_terms()
    return build_filtering_terms_response(terms, resources)
