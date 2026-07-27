/**
 * Source-inspection tests for RouteMapCard chrome (no WebGL / MapLibre runtime).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const cardPath = path.join(process.cwd(), 'components', 'route-map', 'RouteMapCard.tsx')
const mapPath = path.join(process.cwd(), 'components', 'route-map', 'RouteMap.tsx')
const indexPath = path.join(process.cwd(), 'components', 'route-map', 'index.ts')
const typesPath = path.join(process.cwd(), 'components', 'route-map', 'types.ts')
const modelPath = path.join(process.cwd(), 'components', 'route-map', 'buildRouteMapModel.ts')
const rolesPath = path.join(process.cwd(), 'components', 'route-map', 'roleStyles.ts')
const adapterPath = path.join(process.cwd(), 'components', 'route-map', 'toRouteMapBuildInput.ts')
const cssPath = path.join(process.cwd(), 'app', 'globals.css')

function read(filePath: string) {
  return readFileSync(filePath, 'utf8')
}

describe('RouteMapCard structure', () => {
  it('renders card title Route and status badges for idle/calculating/ready/error', () => {
    const source = read(cardPath)
    expect(source).toContain('route-map-card-title')
    expect(source).toMatch(/route-map-card-title[\s\S]{0,120}Route/)
    expect(source).toContain('progressBadgeLabel')
    expect(source).toContain('Ready')
    expect(source).toContain('Error')
    expect(source).toContain("model.status === 'error'")
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain('aria-busy')
  })

  it('uses slim indeterminate progress with motion-safe class', () => {
    const source = read(cardPath)
    expect(source).toContain('role="progressbar"')
    expect(source).toContain('aria-valuemin')
    expect(source).toContain('route-map-indeterminate-bar')
    expect(source).toContain('h-1 w-full')
    const css = read(cssPath)
    expect(css).toContain('@keyframes route-map-indeterminate')
    expect(css).toContain('prefers-reduced-motion: no-preference')
  })

  it('uses a single live region and idle empty overlay without progress bar', () => {
    const source = read(cardPath)
    expect(source).toContain('data-testid="route-map-live"')
    expect(source).toContain('isIdleEmpty')
    expect(source).toMatch(/\{isCalculating && \([\s\S]*role="progressbar"/)
  })

  it('dynamically imports RouteMap with ssr: false and Loading map text', () => {
    const source = read(cardPath)
    expect(source).toContain("dynamic(() => import('./RouteMap')")
    expect(source).toContain('ssr: false')
    expect(source).toContain('Loading map…')
  })

  it('exports embed class for flatter nested chrome', () => {
    const source = read(cardPath)
    expect(source).toContain('ROUTE_MAP_CARD_EMBED_CLASS')
    expect(source).toContain('border-0')
    expect(source).toContain('shadow-none')
  })

  it('renders chips container, truncates long chips, legend from present roles only', () => {
    const source = read(cardPath)
    expect(source).toContain('data-testid="route-map-chips"')
    expect(source).toContain('truncateChipLabel')
    expect(source).toContain('legendRoles')
    expect(source).toContain('ROUTE_MAP_ROLE_SWATCH')
    expect(source).toContain("import type { ReactNode } from 'react'")
    expect(source).toContain('showLineLegend')
  })

  it('reserves Map v2 onMapClick prop only (no drag API in v1 card)', () => {
    const source = read(cardPath)
    expect(source).toContain('onMapClick')
    expect(source).not.toContain('onWaypointDragEnd')
  })

  it('distinguishes Resolving vs Calculating badge from message', () => {
    const source = read(cardPath)
    expect(source).toContain('Resolving…')
    expect(source).toContain('Calculating…')
    expect(source).toMatch(/resolv|geocod|address/)
  })
})

describe('RouteMap MapLibre foundation', () => {
  it('uses MapLibre GL JS with free OpenFreeMap style (no paid key)', () => {
    const source = read(mapPath)
    expect(source).toContain("from 'maplibre-gl'")
    expect(source).toContain("import 'maplibre-gl/dist/maplibre-gl.css'")
    expect(source).toContain('openfreemap.org')
    expect(source).toContain('NEXT_PUBLIC_MAP_STYLE_URL')
    expect(source).toContain('fitBounds')
    expect(source).toMatch(/Why MapLibre|MapLibre \(not Leaflet\)/)
  })

  it('loads maplibre-gl via dynamic import (no top-level default import for Map)', () => {
    // webpack/Next interop leaves `import maplibregl from 'maplibre-gl'` undefined at runtime
    const source = read(mapPath)
    expect(source).not.toMatch(
      /^\s*import\s+maplibregl\s+from\s+['"]maplibre-gl['"]/m
    )
    expect(source).toContain("import('maplibre-gl')")
    expect(source).toMatch(/\.default\s*\?\?\s*/)
    expect(source).toContain('Map failed to load')
    // Types only — no runtime default value import
    expect(source).toMatch(/import\s+type\s*\{[\s\S]*Map\s+as\s+MaplibreMap/)
  })

  it('cleans up load listeners and guards short LineString setData', () => {
    const source = read(mapPath)
    expect(source).toContain("map.off('load'")
    expect(source).toContain('cancelled')
    expect(source).toContain('line.length < 2')
    expect(source).toContain('removeRouteLine')
    expect(source).toContain('ResizeObserver')
    expect(source).toContain('mapRef.current?.resize()')
    // Resize must not re-fit
    const resizeBlock = source.slice(source.indexOf('ResizeObserver'))
    const resizeFn = resizeBlock.slice(0, resizeBlock.indexOf('ro.observe'))
    expect(resizeFn).toContain('.resize()')
    expect(resizeFn).not.toContain('fitToStops')
  })

  it('enables cooperativeGestures only for coarse pointer', () => {
    const source = read(mapPath)
    expect(source).toContain('isCoarsePointer')
    expect(source).toContain("pointer: coarse")
    expect(source).toContain('cooperativeGestures: isCoarsePointer()')
  })

  it('resets empty stops camera and handles near-zero bounds', () => {
    const source = read(mapPath)
    expect(source).toContain('DEFAULT_CENTER')
    expect(source).toContain('NEAR_ZERO_BOUNDS_DEG')
    expect(source).toContain('stops.length === 0')
  })

  it('converts LatLon to LngLat only at MapLibre boundary', () => {
    const source = read(mapPath)
    expect(source).toContain('latLonToLngLat')
    expect(source).toContain('line.map(latLonToLngLat)')
  })

  it('sets min-height map container for mobile/desktop', () => {
    const source = read(mapPath)
    expect(source).toContain('min-h-[280px]')
    expect(source).toContain('md:min-h-[360px]')
  })

  it('respects prefers-reduced-motion for camera animation', () => {
    const source = read(mapPath)
    expect(source).toContain('prefers-reduced-motion')
  })
})

describe('route-map model + public API', () => {
  it('exports RouteMapCard, buildRouteMapModel, toRouteMapBuildInput, LatLon', () => {
    const source = read(indexPath)
    expect(source).toContain('RouteMapCard')
    expect(source).toContain('buildRouteMapModel')
    expect(source).toContain('toRouteMapBuildInput')
    expect(source).toContain('RouteMapViewModel')
    expect(source).toContain('PendingWaypoint')
    expect(source).toContain('LatLon')
    expect(source).toContain('ROUTE_MAP_CARD_EMBED_CLASS')
  })

  it('types LatLon, PendingWaypoint id, roles', () => {
    const source = read(typesPath)
    expect(source).toContain('export type LatLon')
    expect(source).toMatch(/'origin'\s*\|\s*'via'\s*\|\s*'drop'\s*\|\s*'destination'/)
    expect(source).toContain('pendingWaypoints')
    expect(source).toMatch(/id\?:\s*string/)
  })

  it('assigns roles before coord filter; single-stop destination; ready-only chips', () => {
    const source = read(modelPath)
    expect(source).toContain('roleForOriginalIndex')
    expect(source).toContain('originalTotal === 1')
    expect(source).toContain("status !== 'ready'")
    expect(source).toContain('coordsAsGeoJsonLonLat')
  })

  it('shares role colors and pure page adapter', () => {
    expect(read(rolesPath)).toContain('ROUTE_MAP_ROLE_HEX')
    const adapter = read(adapterPath)
    expect(adapter).toContain('toRouteMapBuildInput')
    expect(adapter).toContain('coordsReady')
    expect(adapter).toContain('dimsReady')
  })
})
