#!/usr/bin/env python3
"""Sync demo copies of the Beacon v2 model schemas from ../beacon-v2.

Copies matrix / genomicFeature / expressionValue defaultSchema.json into
``beacon-schemas/`` (and the matrix schema into ``scripts/schemas/``) with the
local ``$ref``s inlined for offline use, and syncs the entry-type definitions
into ``server/beacon/fixtures/data/beaconConfiguration.json``.

  python3 scripts/sync_beacon_schemas.py
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MODELS = REPO.parent / "beacon-v2" / "models" / "json" / "beacon-v2-default-model"

ONTOLOGY_TERM = {
    "type": "object",
    "additionalProperties": True,
    "properties": {"id": {"type": "string"}, "label": {"type": "string"}},
    "required": ["id"],
}
TIMESTAMP = {"type": "string", "format": "date-time"}
INFO = {
    "type": "object",
    "additionalProperties": True,
    "description": "Optional free-form metadata bag.",
}


def inline(node):
    if isinstance(node, list):
        return [inline(x) for x in node]
    if not isinstance(node, dict):
        return node
    ref = node.get("$ref")
    if isinstance(ref, str):
        base = None
        if ref.endswith("ontologyTerm.json"):
            base = ONTOLOGY_TERM
        elif ref.endswith("#/$defs/Timestamp"):
            base = TIMESTAMP
        elif ref.endswith("info.json"):
            base = INFO
        if base is not None:
            out = copy.deepcopy(base)
            out.update({k: inline(v) for k, v in node.items() if k != "$ref"})
            return out
    return {k: inline(v) for k, v in node.items()}


def write(path: Path, doc: dict) -> None:
    path.write_text(json.dumps(doc, indent=4, sort_keys=True) + "\n", encoding="utf-8")
    print("wrote", path.relative_to(REPO))


def main() -> None:
    for src, dest in (
        ("matrices", "matrix.json"),
        ("genomicFeatures", "genomicFeature.json"),
        ("expressionValues", "expressionValue.json"),
    ):
        doc = inline(json.loads((MODELS / src / "defaultSchema.json").read_text()))
        doc["$comment"] = (
            f"Synced from beacon-v2/models/json/.../{src}/defaultSchema.json "
            "(run scripts/sync_beacon_schemas.py); local $refs inlined for offline use"
        )
        write(REPO / "beacon-schemas" / dest, doc)
        if src == "matrices":
            write(REPO / "scripts" / "schemas" / "matrix.beacon-v2.json", doc)

    cfg_path = REPO / "server" / "beacon" / "fixtures" / "data" / "beaconConfiguration.json"
    cfg = json.loads(cfg_path.read_text())
    model_cfg = json.loads((MODELS / "beaconConfiguration.json").read_text())
    for key in ("matrix", "expressionValue", "feature"):
        cfg["entryTypes"][key] = model_cfg["entryTypes"][key]
    write(cfg_path, cfg)


if __name__ == "__main__":
    main()
