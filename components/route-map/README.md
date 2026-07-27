# Route Map v1

World-class **Route** surface for Permit Test: one card with map, slim progress, and chips.

## How to run

No map API key required. MapLibre GL JS uses free OpenFreeMap vector tiles by default:

- Default style: `https://tiles.openfreemap.org/styles/liberty`
- Override: set `NEXT_PUBLIC_MAP_STYLE_URL` to any MapLibre-compatible style URL

```bash
npm install          # installs maplibre-gl
npm run dev          # open /permit-test
```

### CSP / network

Allow map tiles + style hosts (defaults):

- `https://tiles.openfreemap.org` (style + tiles)
- `https://demotiles.maplibre.org` (automatic fallback style if primary fails before first load)

If you override `NEXT_PUBLIC_MAP_STYLE_URL`, allow that host in Content-Security-Policy (`connect-src` / `img-src` / `worker-src` as needed).

### Blank canvas troubleshooting

If Permit Test shows Route **Ready** but the map area is solid gray (no tiles/markers):

1. **Container size / resize** — MapLibre paints blank when constructed at 0×0. `RouteMap` calls `map.resize()` on style `load`, once after `mapReady`, via `ResizeObserver`, and an immediate resize plus two `requestAnimationFrame` follow-ups for late flex layout.
2. **Style / network** — Primary style is trimmed `NEXT_PUBLIC_MAP_STYLE_URL` or OpenFreeMap liberty. On style error before first `load`, the map falls back **once** to `https://demotiles.maplibre.org/style.json` (residual primary errors during the switch are ignored). Permanent fail only if demotiles also fails. Check the console for `[RouteMap] using map style …` and any tile/CSP failures.
3. **Loading vs failure** — Until style loads you should see **Loading map tiles…** (idle empty hint is suppressed until then). Permanent failure shows **Map failed to load** (construct/import still broken, or both primary and demotiles failed).
4. **Env** — Set `NEXT_PUBLIC_MAP_STYLE_URL` only to a MapLibre-compatible style JSON URL (whitespace-only is ignored); restart `npm run dev` after changing env.

## Architecture

| File | Role |
|------|------|
| `types.ts` | `RouteMapStop`, `RouteMapViewModel`, reserved `pendingWaypoints` |
| `buildRouteMapModel.ts` | Pure OR-Tools option / form coords → view model |
| `roleStyles.ts` | Shared marker/legend colors |
| `RouteMap.tsx` | MapLibre canvas (markers, line, fitBounds, resize) — client only |
| `RouteMapCard.tsx` | Card chrome + dynamic import of map (`ssr: false`) |
| `index.ts` | Public exports |

## Why MapLibre

MapLibre is the preferred engine (not Leaflet): OSS fork of Mapbox GL JS, free vector styles without a paid key, solid GeoJSON line layers and `fitBounds`. CSS is imported once inside the map component; the card wraps it in `next/dynamic({ ssr: false })` so WebGL never breaks Next SSR.

## States

- **idle** — origin/dest markers if geocoded; one-line muted hint when empty (after style load)
- **calculating** — same map + slim bar / badge (`Resolving…` vs `Calculating…`); no result chips
- **ready** — stops + route line + chips (corridor, mi, hrs, avoid/prefer honesty)
- **error** — error badge + message; no success chips

Map engine (orthogonal to route status):

- **tiles loading** — style not yet `load` → “Loading map tiles…” (no dual idle stack)
- **style ready** — primary or demotiles fallback painted; markers/line may sync
- **map failed** — construct/import failed, or primary + demotiles both failed → “Map failed to load”

## Map v2 waypoint hook

Types reserve:

```ts
pendingWaypoints?: { lat: number; lon: number; name? }[]
```

`RouteMapCard` / `RouteMap` accept optional `onMapClick` for future click-to-add. **Drag-edit is not implemented or exported in v1** — do not claim drag handlers until Map v2 wires markers.

## Tests

```bash
npx vitest run components/route-map app/permit-test
```

Unit tests cover `buildRouteMapModel` without WebGL. UI tests source-inspect the Permit Test page for Route card wiring.
