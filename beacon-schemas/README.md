# Beacon schemas (demo copies)

JSON Schema copies of the RNA-Get / Beacon v2 default model entries used by this demo.

**Canonical source:** `beacon-v2/models/src/beacon-v2-default-model/` (YAML), compiled to `beacon-v2/models/json/beacon-v2-default-model/`.

| File | Beacon-v2 source |
|------|------------------|
| `matrix.json` | `matrices/defaultSchema` |
| `biosample.json` | `biosamples/defaultSchema` |
| `expressionValue.json` | `expressionValues/defaultSchema` |
| `genomicFeature.json` | `common/genomicFeature` |
| `genomicFeatureWrapper.json` | `genomicFeatures/defaultSchema` (entry wrapper: `id` + `genomicFeature` + `matrixIds`) |

When upstream schemas change, re-sync these files from the JSON tree (or regenerate from the YAML sources). Export validation also keeps a copy of the matrix schema at `scripts/schemas/matrix.beacon-v2.json`.
