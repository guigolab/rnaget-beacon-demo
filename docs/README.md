# Documentation

Guides for the RNAget Beacon demo. New here? Read the [project README](../README.md) first.

## Start here

| Guide | Read it when you want to… |
|---|---|
| [API](api.md) | understand the entry types, request and response shapes, pagination and `requestParameters` |
| [Endpoint coverage](endpoint-coverage.md) | see which Beacon v2 paths the server implements, which the UI calls, and which RNAget extensions exist |
| [Filtering terms](filtering-terms.md) | learn which filters the beacon advertises (ontology vs alphanumeric) and how to send them |

## Data

| Guide | Read it when you want to… |
|---|---|
| [Data package](data-package.md) | understand what the Parquet package contains and how to fetch it locally |
| [Building the package on GitHub Actions](data-package-gha.md) | run or debug the build workflow, or publish a release |

## Where to find things

- Normative OpenAPI: [`rnaget-beacon-schema.yaml`](../rnaget-beacon-schema.yaml), or open [`index.html`](../index.html) for a Swagger UI that needs no server.
- Live docs on a running API: `/docs`, `/redoc`, `/openapi.json`.
- Beacon v2 models: [`../../beacon-v2/models/src/beacon-v2-default-model/`](../../beacon-v2/models/src/beacon-v2-default-model/).

## Vocabulary

| Term | Meaning |
|---|---|
| **matrix** | a quantified expression table (genes × samples) with units, assembly and annotation |
| **genomic feature** | a gene record (`/features`) |
| **biosample** | a sample (tissue, cell type); the sample axis of a matrix |
| **expression value** | one cell of a matrix: a gene measured in a sample |
| **granularity** | how much a Beacon returns: `boolean` (exists), `count` (+ total), `record` (the results) |
| **ontology filter** | `{id}` only, such as `UBERON:0002107` |
| **alphanumeric filter** | `{id, operator, value}`, such as `matrix.unit = TPM` |
