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
    expect(source).toContain("model.status === 'error'")
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain('aria-busy')
  })

  it('uses slim progress on map frame (not a tall hero)', () => {
    const source = read(cardPath)
    expect(source).toContain('role="progressbar"')
    expect(source).toContain('aria-valuemin')
    expect(source).toContain('h-1 w-full')
    expect(source).not.toMatch(/animate-spin shrink-0[\s\S]{0,80}Calculating best route/)
  })

  it('uses a single live region and idle empty overlay without progress bar', () => {
    const source = read(cardPath)
    expect(source).toContain('data-testid="route-map-live"')
    expect(source).toContain('isIdleEmpty')
    // progress only when calculating
    expect(source).toMatch(/\{isCalculating && \([\s\S]*role="progressbar"/)
    // empty idle overlay, no double footer for idle empty
    expect(source).toContain('isIdleEmpty &&')
  })

  it('dynamically imports RouteMap with ssr: false', () => {
    const source = read(cardPath)
    expect(source).toContain("dynamic(() => import('./RouteMap')")
    expect(source).toContain('ssr: false')
  })

  it('renders chips container, truncates long chips, legend from present roles only', () => {
    const source = read(cardPath)
    expect(source).toContain('data-testid="route-map-chips"')
    expect(source).toContain('truncateChipLabel')
    expect(source).toContain('legendRoles')
    expect(source).toContain('ROUTE_MAP_ROLE_SWATCH')
    expect(source).toContain("import type { ReactNode } from 'react'")
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

  it('cleans up load listeners and guards short LineString setData', () => {
    const source = read(mapPath)
    expect(source).toContain("map.off('load'")
    expect(source).toContain('cancelled')
    expect(source).toContain('line.length < 2')
    expect(source).toContain('removeRouteLine')
    expect(source).toContain('ResizeObserver')
    expect(source).toContain('cooperativeGestures')
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

  it('does not export drag-end prop on RouteMap v1', () => {
    const source = read(mapPath)
    expect(source).not.toContain('onWaypointDragEnd')
  })
})

describe('route-map model + public API', () => {
  it('exports RouteMapCard, buildRouteMapModel, and core types', () => {
    const source = read(indexPath)
    expect(source).toContain('RouteMapCard')
    expect(source).toContain('buildRouteMapModel')
    expect(source).toContain('RouteMapViewModel')
    expect(source).toContain('PendingWaypoint')
    expect(source).toContain('ROUTE_MAP_ROLE_HEX')
  })

  it('types RouteMapStop roles and pendingWaypoints extension', () => {
    const source = read(typesPath)
    expect(source).toMatch(/'origin'\s*\|\s*'via'\s*\|\s*'drop'\s*\|\s*'destination'/)
    expect(source).toContain('pendingWaypoints')
    expect(source).toContain('RouteMapViewModel')
  })

  it('assigns roles before coord filter and ready-only chips', () => {
    const source = read(modelPath)
    expect(source).toContain('roleForOriginalIndex')
    expect(source).toContain('status !== \'ready\'')
    expect(source).toContain('coordsAsGeoJsonLonLat')
  })

  it('shares role colors between map and legend', () => {
    const source = read(rolesPath)
    expect(source).toContain('ROUTE_MAP_ROLE_HEX')
    expect(source).toContain('ROUTE_MAP_ROLE_SWATCH')
  })
})
