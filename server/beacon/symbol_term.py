"""Gene symbol as an alphanumeric filtering term (not an ontology resource).

A symbol filter is ``{"id": "symbol", "operator": "=", "value": "TP53"}``. It is
an open-ended alphanumeric field, so it is advertised as a term with no
``values`` (the Beacon schema requires ``values`` to be non-empty when present).
Older packages still carry a ``symbol`` entry in ``resources[]``; it is converted.
"""

from __future__ import annotations

from typing import Any, Dict, List, Sequence, Tuple

SYMBOL_TERM_ID = "symbol"
SYMBOL_TERM_LABEL = "Gene symbol"


def symbol_filtering_term() -> Dict[str, Any]:
    return {
        "type": "alphanumeric",
        "id": SYMBOL_TERM_ID,
        "label": SYMBOL_TERM_LABEL,
        "scopes": ["genomicFeature"],
    }


def is_symbol_resource(resource: Dict[str, Any]) -> bool:
    rid = str(resource.get("id") or "").lower()
    prefix = str(resource.get("nameSpacePrefix") or "").lower()
    return rid == SYMBOL_TERM_ID or prefix == SYMBOL_TERM_ID


def normalize_symbol_term(
    terms: Sequence[Dict[str, Any]],
    resources: Sequence[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Drop any ``symbol`` resource and make sure the alphanumeric term exists.

    The term is added only when a symbol resource was present (legacy catalogs)
    or the term is already there, so catalogs without gene features stay clean.
    """
    kept = [r for r in resources if not is_symbol_resource(r)]
    had_resource = len(kept) != len(resources)
    out = list(terms)
    has_term = any(str(t.get("id") or "") == SYMBOL_TERM_ID for t in out)
    if had_resource and not has_term:
        out.append(symbol_filtering_term())
    return out, kept
