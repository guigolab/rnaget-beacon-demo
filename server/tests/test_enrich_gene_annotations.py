"""Unit tests for NCBI TSV header handling in enrich_gene_annotations."""

from __future__ import annotations

import gzip
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = str(Path(__file__).resolve().parents[2] / "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

from enrich_gene_annotations import (  # noqa: E402
    load_ensembl_to_ncbi,
    load_gene2go_slim,
)


class NcbiTsvHeaderTest(unittest.TestCase):
    def test_gene2go_hash_header_is_normalized(self) -> None:
        """NCBI gene2go.gz uses ``#tax_id`` — must still match tax_id / GO_ID."""
        slim = {"GO:0008150", "GO:0003674"}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gene2go.gz"
            with gzip.open(path, "wt", encoding="utf-8") as fh:
                fh.write(
                    "#tax_id\tGeneID\tGO_ID\tEvidence\tQualifier\tGO_term\tPubMed\tCategory\n"
                )
                fh.write(
                    "9606\t7157\tGO:0008150\tIEA\t-\tbiological_process\t-\tProcess\n"
                )
                fh.write(
                    "9606\t7157\tGO:0003674\tIEA\t-\tmolecular_function\t-\tFunction\n"
                )
                fh.write(
                    "10090\t12575\tGO:0008150\tIEA\t-\tbiological_process\t-\tProcess\n"
                )
                # Non-slim term must be ignored.
                fh.write(
                    "9606\t7157\tGO:9999999\tIEA\t-\tnot_in_slim\t-\tProcess\n"
                )
            by_gene = load_gene2go_slim(path, slim_ids=slim)
        self.assertEqual(by_gene.keys(), {"7157"})
        self.assertEqual(by_gene["7157"], slim)

    def test_gene2ensembl_hash_header_is_normalized(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gene2ensembl.gz"
            with gzip.open(path, "wt", encoding="utf-8") as fh:
                fh.write(
                    "#tax_id\tGeneID\tEnsembl_gene_identifier\tRNA_nucleotide_accession.version\t"
                    "Ensembl_rna_identifier\tprotein_accession.version\tEnsembl_protein_identifier\n"
                )
                fh.write(
                    "9606\t7157\tENSG00000141510\t-\t-\t-\t-\n"
                )
                fh.write(
                    "10090\t12575\tENSMUSG00000000001\t-\t-\t-\t-\n"
                )
            mapping = load_ensembl_to_ncbi(path)
        self.assertEqual(mapping.get("ENSG00000141510"), "7157")
        self.assertNotIn("ENSMUSG00000000001", mapping)


if __name__ == "__main__":
    unittest.main()
