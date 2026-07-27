# Route Map v1

World-class **Route** surface for Permit Test: one card with map, slim progress, and chips.

## How to run

No map API key required.

- **Tiles:** OpenStreetMap raster (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`)
- **Engine:** Leaflet (markers + polyline + fitBounds) — no Web Worker / WebGL

```bash
npm install          # installs leaflet
npm run dev          # open /permit-test
```

### Why Leaflet for v1

MapLibre under Next kept failing (worker MIME `text/html`, critical dependency, blank canvas / infinite **Loading map tiles**). Leaflet needs no worker for our v1 use case and is reliable on Windows/Next.

MapLibre remains a reasonable **later** option if we need vector styles or advanced GL layers. Foundation (card, model, chips, progress) is engine-agnostic — only the canvas renderer changes.

### CSP / network

Allow:

- `https://*.tile.openstreetmap.org` (raster tiles)
- OSM attribution link host if locked down

### Blank canvas / layout troubleshooting

1. **Container size** — `map.invalidateSize()` on `whenReady`, after `mapReady`, via `ResizeObserver`, and immediate + two rAF follow-ups. If the first `fitToStops` ran at 0×0, re-fit once when the container becomes non-zero (`fitPendingUntilSized`).
2. **Loading vs failure** — Until map `whenReady`: **Loading map…**. Permanent: **Map failed to load** (import/construct failed).
3. **Tiles** — OSM tile hosts; check network tab if basemap is empty but markers appear.

## Architecture

| File | Role |
|------|------|
| `types.ts` | `RouteMapStop`, `RouteMapViewModel`, reserved `pendingWaypoints` |
| `buildRouteMapModel.ts` | Pure OR-Tools option / form coords → view model |
| `roleStyles.ts` | Shared marker/legend colors |
| `RouteMap.tsx` | Leaflet canvas (markers, polyline, fitBounds, invalidateSize) — client only |
| `RouteMapCard.tsx` | Card chrome + dynamic import of map (`ssr: false`) |
| `index.ts` | Public exports |

## States

- **idle** — origin/dest markers if geocoded; one-line muted hint when empty (after map ready)
- **calculating** — same map + slim bar / badge (`Resolving…` vs `Calculating…`); no result chips
- **ready** — stops + route line + chips (corridor, mi, hrs, avoid/prefer honesty)
- **error** — error badge + message; no success chips

Map engine (orthogonal to route status):

- **map loading** — before Leaflet `whenReady` → “Loading map…”
- **map ready** — Leaflet `whenReady`; markers/line may sync (`onStyleLoaded(true)` for card contract)
- **map failed** — import/construct failed → “Map failed to load”

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

Unit tests cover model + Leaflet source contracts without a browser map runtime.
