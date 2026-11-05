# RNA-Get Explorer

Next.js App Router frontend for the Beacon v2–style RNA-Get API. Built as a **static export** and served by nginx under `/rnaget-beacon/`. The API is proxied at `/rnaget-beacon/api/` (see `nginx/`).

API contract: server routers + [`../rnaget-beacon-schema.yaml`](../rnaget-beacon-schema.yaml). Root filtering-term discovery is **`GET /filtering_terms` only**. Slice params go under `query.requestParameters` on POST (never top-level). Expression densify uses axis lists + `expression_values` cells (no response-envelope `info.axes`).

## Lenses and routes

| Route | Purpose |
|-------|---------|
| `/` | Light-themed home: scope legend, entry-type cards, ontology resources, namespace×scope filtering chips (popover detail) |
| `/features/` | Features lens: `GET /filtering_terms` (scope `genomicFeature`), multi-filter search (symbol/HGNC/SO/`expression.percentile:>=:90|95|99`/…), top-percentile matrix heatmap (`POST /matrices/{id}/features` with alphanumeric percentile + `featureIDList`) + popovers |
| `/biosamples/` | Biosamples lens: tissue/ontology filters, matrix-grouped sample strips + popovers |
| `/biosamples/` | Biosamples lens: root `GET /filtering_terms` sidebar (scope `biosample`), compound query bar + probe, preview table (load 5 more), `?sample=` selection |
| `/matrices/` | Matrix lens: root `GET /filtering_terms` sidebar (scope `matrix`), query bar + probe, matrix preview table |
| `/matrices/[id]` | Matrix workspace (heatmap, provenance) |

Every page includes a floating **Show API call** drawer (last Beacon request + curl).

Stack: TanStack Query, ECharts, Tailwind 4, shadcn/base-ui.

## Local UI against a running API

Start the API first (e.g. `DATA_PACKAGE_PATH=../data/rnaget-demo uvicorn app:app --host 0.0.0.0 --port 5000` from `server/`, or `docker compose -f docker-compose-dev.yml up server`).

```bash
cd front
pnpm install   # or npm ci
pnpm dev
```

Open http://localhost:3000/rnaget-beacon/

By default the UI calls `/rnaget-beacon/api/…`. **`next dev` proxies that to `http://127.0.0.1:5000`** (override with `API_PROXY_TARGET`). Alternatively set `NEXT_PUBLIC_API_BASE_URL=http://localhost:5000` to call the API directly (requires CORS on the server).

## Production-like Docker

From the repo root (with `data/rnaget-demo` prepared):

```bash
docker compose -f docker-compose-dev.yml up --build
```

- UI: http://localhost:94/rnaget-beacon/
- API via nginx: http://localhost:94/rnaget-beacon/api/matrices
- Direct API: http://localhost:5000/docs

## Build notes

- `output: 'export'` + `basePath: '/rnaget-beacon'`
- `NEXT_PUBLIC_API_BASE_URL` defaults to `/rnaget-beacon/api` in the nginx image build
- Matrix detail pages are pre-rendered for known package IDs (or `MATRIX_IDS` / `API_BUILD_URL` at build time)
- Feature/biosample records open in a global right sheet (`?recordKind=feature|biosample&recordId=…` on any lens route)
