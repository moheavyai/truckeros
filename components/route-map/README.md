# Route Map v1

World-class **Route** surface for Permit Test: one card with map, slim progress, and chips.

## How to run

No map API key required.

- **Default style:** `https://demotiles.maplibre.org/style.json` (reliable for local Next dev)
- **Override:** set `NEXT_PUBLIC_MAP_STYLE_URL` to any MapLibre-compatible style URL
- **Fallback:** if primary fails before first `load`, once to OpenFreeMap liberty

```bash
npm install          # installs maplibre-gl
npm run dev          # open /permit-test
```

### Worker (Next MIME `text/html` fix)

MapLibre runs a Web Worker. If the worker URL is resolved to a Next **document** route, the browser reports:

> module script … MIME type "text/html"

and the style never finishes → **Loading map tiles…** forever while the card can still show **Ready**.

`RouteMap` calls `setWorkerUrl` **before** `new Map`:

1. Prefer bundler asset: `maplibre-gl/dist/maplibre-gl-worker.mjs?url`
2. Else same-origin **`/maplibre-gl-worker.mjs`** from `public/` (plus sibling `maplibre-gl-shared.mjs`)

These files are copied from `node_modules/maplibre-gl/dist/` into `public/`. After upgrading `maplibre-gl`, re-copy:

```bash
# PowerShell
Copy-Item node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs public/
Copy-Item node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs public/
```

### CSP / network

Allow:

- `https://demotiles.maplibre.org` (default style + tiles)
- `https://tiles.openfreemap.org` (optional fallback style + tiles)
- `worker-src` / `script-src` for same-origin `/maplibre-gl-worker.mjs` (and blob if bundler uses blob workers)

If you override `NEXT_PUBLIC_MAP_STYLE_URL`, allow that host.

### Blank canvas / stuck tiles troubleshooting

1. **Worker MIME** — Console shows MIME `text/html` for a worker → confirm `public/maplibre-gl-worker.mjs` + `maplibre-gl-shared.mjs` exist; check logs for `[RouteMap] maplibre worker url`.
2. **Container size / resize** — `map.resize()` on style `load`, after `mapReady`, via `ResizeObserver`, and immediate + two rAF follow-ups.
3. **Style / network** — Default demotiles; env override; one OpenFreeMap fallback. Console: `[RouteMap] using map style …`.
4. **Loading vs failure** — Until style `load`: **Loading map tiles…**. Permanent: **Map failed to load** (import/construct/worker+style both failed).
5. **Env** — Restart `npm run dev` after changing `NEXT_PUBLIC_MAP_STYLE_URL`.

## Architecture

| File | Role |
|------|------|
| `types.ts` | `RouteMapStop`, `RouteMapViewModel`, reserved `pendingWaypoints` |
| `buildRouteMapModel.ts` | Pure OR-Tools option / form coords → view model |
| `roleStyles.ts` | Shared marker/legend colors |
| `configureMaplibreWorker.ts` | `setWorkerUrl` + default/fallback style URLs |
| `RouteMap.tsx` | MapLibre canvas (markers, line, fitBounds, resize) — client only |
| `RouteMapCard.tsx` | Card chrome + dynamic import of map (`ssr: false`) |
| `index.ts` | Public exports |

## Why MapLibre

MapLibre is the preferred engine (not Leaflet): OSS fork of Mapbox GL JS, free styles without a paid key, solid GeoJSON line layers and `fitBounds`. CSS is imported once inside the map component; the card wraps it in `next/dynamic({ ssr: false })` so WebGL never breaks Next SSR.

## States

- **idle** — origin/dest markers if geocoded; one-line muted hint when empty (after style load)
- **calculating** — same map + slim bar / badge (`Resolving…` vs `Calculating…`); no result chips
- **ready** — stops + route line + chips (corridor, mi, hrs, avoid/prefer honesty)
- **error** — error badge + message; no success chips

Map engine (orthogonal to route status):

- **tiles loading** — style not yet `load` → “Loading map tiles…”
- **style ready** — primary or fallback painted; markers/line may sync
- **map failed** — construct/import/worker+style failed → “Map failed to load”

## Map v2 waypoint hook

Types reserve:

```ts
pendingWaypoints?: { lat: number; lon: number; name? }[]
```

`RouteMapCard` / `RouteMap` accept optional `onMapClick` for future click-to-add. **Drag-edit is not implemented or exported in v1**.

## Tests

```bash
npx vitest run components/route-map app/permit-test/route-map-ui.test.ts
```

Unit tests cover model + worker/style helpers without WebGL.
