"""Load RNA-Get entity JSON Schemas into FastAPI OpenAPI components."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Dict, List, Type

from pydantic import BaseModel
from pydantic.json_schema import models_json_schema

from .envelopes import (
    BeaconBooleanResponse,
    BeaconCountResponse,
    BeaconErrorResponse,
    BeaconFilteringTermsResponse,
    BeaconInformationalResponse,
    BeaconQuery,
    BeaconRequestMeta,
    BeaconResultsetsResponse,
    Pagination,
    ResultsetInstance,
)

# Repo root: server/beacon/schemas -> ../../../beacon-schemas
_SCHEMAS_DIR = Path(__file__).resolve().parents[3] / "beacon-schemas"

# OpenAPI component name -> filename
_ENTITY_FILES = {
    "Matrix": "matrix.json",
    "Biosample": "biosample.json",
    "GenomicFeature": "genomicFeature.json",
    "GenomicFeatureWrapper": "genomicFeatureWrapper.json",
    "ExpressionValue": "expressionValue.json",
}

_ENVELOPE_MODELS: List[Type[BaseModel]] = [
    BeaconBooleanResponse,
    BeaconCountResponse,
    BeaconResultsetsResponse,
    BeaconErrorResponse,
    BeaconInformationalResponse,
    BeaconFilteringTermsResponse,
    BeaconQuery,
    BeaconRequestMeta,
    Pagination,
    ResultsetInstance,
]


def _rewrite_local_refs(node: Any) -> Any:
    """Rewrite ./file.json refs to OpenAPI component refs."""
    if isinstance(node, dict):
        out: Dict[str, Any] = {}
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str):
                if value in ("./genomicFeature.json", "genomicFeature.json"):
                    out[key] = "#/components/schemas/GenomicFeature"
                else:
                    out[key] = value
            else:
                out[key] = _rewrite_local_refs(value)
        return out
    if isinstance(node, list):
        return [_rewrite_local_refs(item) for item in node]
    return node


def load_entity_schemas() -> Dict[str, Any]:
    """Return OpenAPI components.schemas entries for Beacon entity types."""
    schemas: Dict[str, Any] = {}
    for name, filename in _ENTITY_FILES.items():
        path = _SCHEMAS_DIR / filename
        if not path.is_file():
            continue
        raw = json.loads(path.read_text(encoding="utf-8"))
        schema = copy.deepcopy(raw)
        schema.pop("$schema", None)
        schema.pop("$comment", None)
        schema = _rewrite_local_refs(schema)
        schemas[name] = schema
    return schemas


def _rewrite_defs_refs(node: Any) -> Any:
    """Rewrite #/$defs/Name refs to OpenAPI component refs."""
    if isinstance(node, dict):
        out: Dict[str, Any] = {}
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str) and value.startswith("#/$defs/"):
                out[key] = "#/components/schemas/" + value[len("#/$defs/") :]
            else:
                out[key] = _rewrite_defs_refs(value)
        return out
    if isinstance(node, list):
        return [_rewrite_defs_refs(item) for item in node]
    return node


def _inject_envelope_schemas(schemas: Dict[str, Any]) -> None:
    """Register Beacon envelope Pydantic models (needed for oneOf $refs).

    ``models_json_schema`` with ``ref_template`` yields stub ``$ref`` entries in
    ``model_map``; real bodies live under ``$defs``. Prefer ``$defs`` so we do
    not leave self-referential stubs like ``BeaconQuery: {$ref: BeaconQuery}``.
    """
    _model_map, extras = models_json_schema(
        [(model, "serialization") for model in _ENVELOPE_MODELS],
        ref_template="#/components/schemas/{model}",
    )
    for name, value in (extras.get("$defs") or {}).items():
        if isinstance(value, dict):
            schemas[name] = _rewrite_defs_refs(value)
    # Ensure every requested model has an entry (fallback if missing from $defs).
    for model in _ENVELOPE_MODELS:
        name = model.__name__
        if name in schemas:
            continue
        single_map, single_extras = models_json_schema(
            [(model, "serialization")],
            ref_template="#/components/schemas/{model}",
        )
        for def_name, def_value in (single_extras.get("$defs") or {}).items():
            if isinstance(def_value, dict):
                schemas.setdefault(def_name, _rewrite_defs_refs(def_value))
        for key, value in single_map.items():
            if isinstance(key, tuple):
                rewritten = _rewrite_defs_refs(value)
                if (
                    isinstance(rewritten, dict)
                    and rewritten.get("$ref") == f"#/components/schemas/{name}"
                ):
                    continue
                schemas.setdefault(name, rewritten)


def patch_openapi_schema(openapi_schema: Dict[str, Any]) -> Dict[str, Any]:
    """Inject entity schemas and type ResultsetInstance.results items."""
    components = openapi_schema.setdefault("components", {})
    schemas = components.setdefault("schemas", {})
    _inject_envelope_schemas(schemas)
    schemas.update(load_entity_schemas())

    resultset = schemas.get("ResultsetInstance")
    if isinstance(resultset, dict):
        props = resultset.setdefault("properties", {})
        props["results"] = {
            "type": "array",
            "nullable": True,
            "description": (
                "Page of entity records. Item schema depends on setType: "
                "matrix → Matrix, feature → GenomicFeatureWrapper, "
                "biosample → Biosample, expressionValue → ExpressionValue."
            ),
            "items": {
                "oneOf": [
                    {"$ref": "#/components/schemas/Matrix"},
                    {"$ref": "#/components/schemas/GenomicFeatureWrapper"},
                    {"$ref": "#/components/schemas/Biosample"},
                    {"$ref": "#/components/schemas/ExpressionValue"},
                ]
            },
        }

    return openapi_schema
