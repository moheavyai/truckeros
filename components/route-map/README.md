# Route Map v1

World-class **Route** surface for Permit Test: one card with map, slim progress, and chips.

## How to run

No map API key required. MapLibre GL JS uses free OpenFreeMap vector tiles:

- Style: `https://tiles.openfreemap.org/styles/liberty`

```bash
npm install          # installs maplibre-gl
npm run dev          # open /permit-test
```

## Architecture

| File | Role |
|------|------|
| `types.ts` | `RouteMapStop`, `RouteMapViewModel`, reserved `pendingWaypoints` |
| `buildRouteMapModel.ts` | Pure OR-Tools option / form coords → view model |
| `RouteMap.tsx` | MapLibre canvas (markers, line, fitBounds) — client only |
| `RouteMapCard.tsx` | Card chrome + dynamic import of map (`ssr: false`) |
| `index.ts` | Public exports |

## Why MapLibre

MapLibre is the preferred engine (not Leaflet): OSS fork of Mapbox GL JS, free vector styles without a paid key, solid GeoJSON line layers and `fitBounds`. CSS is imported once inside the map component; the card wraps it in `next/dynamic({ ssr: false })` so WebGL never breaks Next SSR.

## States

- **idle** — origin/dest markers if geocoded; one-line muted hint when empty
- **calculating** — same map + slim bar / badge (not a tall progress hero)
- **ready** — stops + route line + chips (corridor, mi, hrs, avoid/prefer honesty)
- **error** — error badge + message

## Map v2 waypoint hook

Types already reserve:

```ts
pendingWaypoints?: { lat: number; lon: number; name? }[]
```

`RouteMap` / `RouteMapCard` accept optional `onMapClick` and `onWaypointDragEnd` props. **Do not wire click-to-add or drag editing in v1** — only pass handlers when building the v2 editor.

## Tests

```bash
npx vitest run components/route-map app/permit-test
```

Unit tests cover `buildRouteMapModel` without WebGL. UI tests source-inspect the Permit Test page for Route card wiring.
