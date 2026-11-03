"""Shared Beacon filter resolution for routers."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from fastapi.responses import JSONResponse

from beacon.filters import (
    NormalizedFilter,
    filters_to_summary,
    normalize_filters,
    parse_get_filters_csv,
    split_biosample_matrices_filters,
    split_expression_value_filters,
    split_feature_matrices_filters,
    split_matrix_axis_filters,
    validate_filters_for_entity,
)
from beacon.responses import error_json


def _parse_filters(
    *,
    filters_csv: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
) -> List[NormalizedFilter]:
    if body is not None:
        query = body.get("query") or {}
        raw = query.get("filters") if isinstance(query, dict) else None
        return normalize_filters(raw)
    return parse_get_filters_csv(filters_csv)


def resolve_entity_filters(
    *,
    entity: str,
    filters_csv: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
    received: Optional[Dict[str, Any]] = None,
):
    try:
        filters = _parse_filters(filters_csv=filters_csv, body=body)
        err = validate_filters_for_entity(filters, entity=entity)
        if err:
            return None, error_json(400, err, received=received)
        return filters, None
    except ValueError as exc:
        return None, error_json(400, str(exc), received=received)


def resolve_matrix_feature_axis_filters(
    *,
    filters_csv: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
    received: Optional[Dict[str, Any]] = None,
):
    """Feature-scoped and biosample-scoped filters for ``/matrices/{id}/features``."""
    try:
        filters = _parse_filters(filters_csv=filters_csv, body=body)
    except ValueError as exc:
        return None, error_json(400, str(exc), received=received)
    split, err = split_matrix_axis_filters(filters)
    if err:
        return None, error_json(400, err, received=received)
    return split, None


def resolve_expression_value_filters(
    *,
    filters_csv: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
    received: Optional[Dict[str, Any]] = None,
):
    """Split filters for ``/matrices/{id}/expression_values``."""
    try:
        filters = _parse_filters(filters_csv=filters_csv, body=body)
    except ValueError as exc:
        return None, error_json(400, str(exc), received=received)
    split, err = split_expression_value_filters(filters)
    if err:
        return None, error_json(400, err, received=received)
    return split, None


def resolve_feature_matrices_filters(
    *,
    filters_csv: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
    received: Optional[Dict[str, Any]] = None,
):
    """Split filters for ``/features/{id}/matrices``."""
    try:
        filters = _parse_filters(filters_csv=filters_csv, body=body)
    except ValueError as exc:
        return None, error_json(400, str(exc), received=received)
    split, err = split_feature_matrices_filters(filters)
    if err:
        return None, error_json(400, err, received=received)
    return split, None


def resolve_biosample_matrices_filters(
    *,
    filters_csv: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
    received: Optional[Dict[str, Any]] = None,
):
    """Split filters for ``/biosamples/{id}/matrices``."""
    try:
        filters = _parse_filters(filters_csv=filters_csv, body=body)
    except ValueError as exc:
        return None, error_json(400, str(exc), received=received)
    split, err = split_biosample_matrices_filters(filters)
    if err:
        return None, error_json(400, err, received=received)
    return split, None


def filters_summary(filters) -> Optional[Dict[str, Any]]:
    if not filters:
        return None
    return {"filters": filters_to_summary(filters)}
