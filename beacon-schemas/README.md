# Beacon schemas (demo copies)

JSON Schema copies of the RNA-Get / Beacon v2 default model entries used by this demo.

**Canonical source:** `beacon-v2/models/src/beacon-v2-default-model/` (YAML), compiled to `beacon-v2/models/json/beacon-v2-default-model/`.

| File | Beacon-v2 source |
|------|------------------|
| `matrix.json` | `matrices/defaultSchema` |
| `biosample.json` | `biosamples/defaultSchema` |
| `expressionValue.json` | `expressionValues/defaultSchema` |
| `genomicFeature.json` | `genomicFeatures/defaultSchema` (flat feature entry) |

**Envelope schemas:** `framework/json/` is a vendored copy of [ga4gh-beacon/beacon-v2 `framework/json`](https://github.com/ga4gh-beacon/beacon-v2/tree/main/framework/json) (~80 JSON files). Server tests validate API envelopes against `responses/beaconResultsetsResponse.json`. CI and runtime use only this in-repo tree (no separate beacon-v2 clone).

When upstream schemas change, re-sync these files from the JSON tree (or regenerate from the YAML sources). Export validation also keeps a copy of the matrix schema at `scripts/schemas/matrix.beacon-v2.json`.
