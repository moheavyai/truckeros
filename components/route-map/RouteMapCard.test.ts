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

function read(filePath: string) {
  return readFileSync(filePath, 'utf8')
}

describe('RouteMapCard structure', () => {
  it('renders card title Route and status badges for idle/calculating/ready/error', () => {
    const source = read(cardPath)
    expect(source).toContain('route-map-card-title')
    expect(source).toMatch(/route-map-card-title[\s\S]{0,120}Route/)
    expect(source).toContain('Calculating…')
    expect(source).toContain('Ready')
    expect(source).toContain("model.status === 'error'")
    expect(source).toContain('aria-live="polite"')
  })

  it('uses slim progress on map frame (not a tall hero)', () => {
    const source = read(cardPath)
    expect(source).toContain('role="progressbar"')
    expect(source).toContain('h-1 w-full')
    expect(source).not.toMatch(/animate-spin shrink-0[\s\S]{0,80}Calculating best route/)
  })

  it('dynamically imports RouteMap with ssr: false', () => {
    const source = read(cardPath)
    expect(source).toContain("dynamic(() => import('./RouteMap')")
    expect(source).toContain('ssr: false')
  })

  it('renders chips container and legend roles', () => {
    const source = read(cardPath)
    expect(source).toContain('data-testid="route-map-chips"')
    expect(source).toContain('Origin')
    expect(source).toContain('Via')
    expect(source).toContain('Drop')
    expect(source).toContain('Destination')
  })

  it('reserves Map v2 onMapClick prop', () => {
    const source = read(cardPath)
    expect(source).toContain('onMapClick')
  })
})

describe('RouteMap MapLibre foundation', () => {
  it('uses MapLibre GL JS with free OpenFreeMap style (no paid key)', () => {
    const source = read(mapPath)
    expect(source).toContain("from 'maplibre-gl'")
    expect(source).toContain("import 'maplibre-gl/dist/maplibre-gl.css'")
    expect(source).toContain('openfreemap.org')
    expect(source).toContain('fitBounds')
    expect(source).toMatch(/Why MapLibre|MapLibre \(not Leaflet\)/)
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

describe('route-map public API', () => {
  it('exports RouteMapCard, buildRouteMapModel, and core types', () => {
    const source = read(indexPath)
    expect(source).toContain('RouteMapCard')
    expect(source).toContain('buildRouteMapModel')
    expect(source).toContain('RouteMapViewModel')
    expect(source).toContain('PendingWaypoint')
  })

  it('types RouteMapStop roles and pendingWaypoints extension', () => {
    const source = read(typesPath)
    expect(source).toMatch(/'origin'\s*\|\s*'via'\s*\|\s*'drop'\s*\|\s*'destination'/)
    expect(source).toContain('pendingWaypoints')
    expect(source).toContain('RouteMapViewModel')
  })
})
