import json
from pathlib import Path
from typing import Any, Dict, List

DATA_DIR = Path(__file__).resolve().parent / "data"


def _load(name: str) -> Any:
    path = DATA_DIR / name
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def load_all() -> Dict[str, Any]:
    return {
        "matrices": _load("matrices.json"),
        "features": _load("features.json"),
        "biosamples": _load("biosamples.json"),
        "expressionValues": _load("expressionValues.json"),
        "biosampleMatrices": _load("biosample_matrices.json"),
    }


def strip_schema(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned = []
    for rec in records:
        item = {k: v for k, v in rec.items() if k != "$schema"}
        cleaned.append(item)
    return cleaned
