# RNA-Get Explorer

Next.js App Router frontend for the Beacon v2–style RNA-Get API. Built as a **static export** and served by nginx under `/rnaget-beacon/`. The API is proxied at `/rnaget-beacon/api/` (see `nginx/`).

## Lenses and routes

| Route | Purpose |
|-------|---------|
| `/` | Light-themed home: scope legend, entry-type cards, ontology resources, namespace×scope filtering chips (popover detail) |
| `/features/` | Features lens: `GET /features/filtering_terms` namespaces, multi-filter search (symbol/HGNC/SO/…), matrix median heatmap + popovers |
| `/biosamples/` | Biosamples lens: filtering_terms sidebar, compound query bar + probe, preview table (load 5 more), `?sample=` selection |
| `/matrices/` | Matrix lens: `/matrices/filtering_terms` sidebar, query bar + probe, matrix preview table |
| `/matrices/[id]` | Matrix workspace (heatmap, provenance) |

Every page includes a floating **Show API call** drawer (last Beacon request + curl).

Stack: TanStack Query, ECharts, Tailwind 4, shadcn/base-ui.

## Local UI against a running API

```bash
cd front
pnpm install   # or npm ci
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000 pnpm dev
```

Open http://localhost:3000/rnaget-beacon/ (basePath is set).

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
