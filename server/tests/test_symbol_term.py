"""Gene symbol is advertised as an alphanumeric term, never as a resource."""

import unittest

from beacon.symbol_term import normalize_symbol_term, symbol_filtering_term
from beacon.matrix_axis_catalog import _subset_terms

LEGACY_RESOURCE = {
    "id": "symbol",
    "name": "Gene symbol",
    "nameSpacePrefix": "symbol",
}
HGNC = {"id": "hgnc", "name": "HGNC", "nameSpacePrefix": "HGNC"}


class SymbolTermTest(unittest.TestCase):
    def test_term_shape_has_no_values(self) -> None:
        term = symbol_filtering_term()
        self.assertEqual(term["type"], "alphanumeric")
        self.assertEqual(term["scopes"], ["genomicFeature"])
        self.assertNotIn("values", term)

    def test_legacy_resource_is_converted(self) -> None:
        terms, resources = normalize_symbol_term([], [HGNC, LEGACY_RESOURCE])
        self.assertEqual([r["id"] for r in resources], ["hgnc"])
        self.assertEqual([t["id"] for t in terms], ["symbol"])

    def test_existing_term_not_duplicated(self) -> None:
        terms, resources = normalize_symbol_term(
            [symbol_filtering_term()], [LEGACY_RESOURCE]
        )
        self.assertEqual(len(terms), 1)
        self.assertEqual(resources, [])

    def test_no_symbol_anywhere_stays_clean(self) -> None:
        terms, resources = normalize_symbol_term([], [HGNC])
        self.assertEqual(terms, [])
        self.assertEqual(resources, [HGNC])

    def test_matrix_subset_keeps_symbol_term_only_with_features(self) -> None:
        global_terms = [symbol_filtering_term()]
        with_features, res = _subset_terms(
            global_terms,
            [HGNC],
            present_ids=set(),
            alphanumeric={},
            scope="genomicFeature",
            keep_symbol_term=True,
        )
        self.assertEqual([t["id"] for t in with_features], ["symbol"])
        self.assertFalse(any(r["id"] == "symbol" for r in res))
        without, _ = _subset_terms(
            global_terms,
            [HGNC],
            present_ids=set(),
            alphanumeric={},
            scope="genomicFeature",
            keep_symbol_term=False,
        )
        self.assertEqual(without, [])


if __name__ == "__main__":
    unittest.main()
