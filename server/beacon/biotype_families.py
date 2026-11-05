"""Roll Sequence Ontology / biotype ids into coarse feature families."""

from __future__ import annotations

from typing import Dict, FrozenSet, Iterable, Optional, Set

# Family → SO ids (featureType and/or ontologyTerms / biotype).
BIOTYPE_FAMILY_SO: Dict[str, FrozenSet[str]] = {
    "protein_coding": frozenset(
        {
            # Do not include SO:0000704 (generic "gene"): hydrate puts that on
            # feature_type_id for nearly all gene rows; real biotype lives in
            # ontology_terms (e.g. SO:0001217 protein_coding_gene).
            "SO:0001217",  # protein_coding_gene
            "SO:0002123",
            "SO:0002124",
            "SO:0002125",
            "SO:0002126",
            "SO:0002134",
            "SO:0002135",
            "SO:0002136",
            "SO:0002137",
        }
    ),
    "lncRNA": frozenset(
        {
            "SO:0002127",
            "SO:0002182",
            "SO:0002183",
            "SO:0002184",
            "SO:0002185",
            "SO:0001503",  # processed_transcript (often lnc-like)
        }
    ),
    "pseudogene": frozenset(
        {
            "SO:0000336",
            "SO:0000043",
            "SO:0001759",
            "SO:0001760",
            "SO:0001841",
            "SO:0002102",
            "SO:0002103",
            "SO:0002105",
            "SO:0002106",
            "SO:0002107",
            "SO:0002108",
            "SO:0002109",
        }
    ),
    "sncRNA": frozenset(
        {
            "SO:0000602",
            "SO:0001265",
            "SO:0001266",
            "SO:0001267",
            "SO:0001268",
            "SO:0001269",
            "SO:0001272",
            "SO:0001637",
            "SO:0001639",
            "SO:0001640",
            "SO:0001643",
            "SO:0002181",
            "SO:0002358",
            "SO:0002359",
        }
    ),
    "other": frozenset(
        {
            "SO:0000458",
            "SO:0000466",
            "SO:0000470",
            "SO:0000478",
            "SO:0001263",  # ncRNA_gene (generic)
        }
    ),
}

BIOTYPE_FAMILY_IDS = frozenset(BIOTYPE_FAMILY_SO.keys())

_SO_TO_FAMILY: Dict[str, str] = {}
for _fam, _ids in BIOTYPE_FAMILY_SO.items():
    for _oid in _ids:
        # First assignment wins if an SO id is listed in more than one family.
        _SO_TO_FAMILY.setdefault(_oid.upper(), _fam)


def family_for_so_id(so_id: str) -> Optional[str]:
    return _SO_TO_FAMILY.get(str(so_id).upper())


def so_ids_for_family(family: str) -> FrozenSet[str]:
    return BIOTYPE_FAMILY_SO.get(family, frozenset())


def feature_so_ids(feature_type_id: Optional[str], ontology_term_ids: Iterable[str]) -> Set[str]:
    out: Set[str] = set()
    if feature_type_id:
        out.add(str(feature_type_id))
    for oid in ontology_term_ids:
        if oid:
            out.add(str(oid))
    return out


def feature_matches_biotype_family(
    family: str,
    *,
    feature_type_id: Optional[str],
    ontology_term_ids: Iterable[str],
) -> bool:
    wanted = so_ids_for_family(family)
    if not wanted:
        return False
    present = {x.upper() for x in feature_so_ids(feature_type_id, ontology_term_ids)}
    return bool(present & {x.upper() for x in wanted})


def families_present_in(so_ids: Iterable[str]) -> Set[str]:
    found: Set[str] = set()
    for oid in so_ids:
        fam = family_for_so_id(oid)
        if fam:
            found.add(fam)
    return found
