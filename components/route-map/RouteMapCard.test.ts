/**
 * Source-inspection tests for RouteMapCard chrome + Leaflet RouteMap (no DOM / browser map).
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
  // Normalize CRLF so source-inspection asserts match on Windows checkouts
  return readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
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
    // Progress gated by showCalculating (also suppressed when mapLoadFailed)
    expect(source).toMatch(/\{showCalculating && \([\s\S]*role="progressbar"/)
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
    expect(source).toMatch(/import\s*\{[^}]*\btype\s+ReactNode\b[^}]*\}\s*from\s*['"]react['"]/)
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

describe('RouteMap Leaflet foundation', () => {
  it('uses Leaflet with OSM tiles (no paid key, no MapLibre worker)', () => {
    const source = read(mapPath)
    expect(source).toContain("from 'leaflet'")
    expect(source).toContain("import 'leaflet/dist/leaflet.css'")
    expect(source).toContain('openstreetmap.org')
    expect(source).toContain('OSM_TILE_URL')
    expect(source).toContain('fitBounds')
    expect(source).toContain('invalidateSize')
    expect(source).toMatch(/Why Leaflet|Leaflet \(v1\)/)
    // MapLibre path fully removed
    expect(source).not.toContain('maplibre')
    expect(source).not.toContain('MapLibre')
    expect(source).not.toContain('setWorkerUrl')
    expect(source).not.toContain('configureMaplibreWorker')
  })

  it('loads leaflet via dynamic import inside useEffect (client only)', () => {
    const source = read(mapPath)
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    // Ban value imports of leaflet under any binding name (default / namespace).
    // Type-only `import type { Map as LeafletMap }` must still pass.
    expect(codeOnly).not.toMatch(/import\s+[A-Za-z_$][\w$]*\s+from\s+['"]leaflet['"]/)
    expect(codeOnly).not.toMatch(/import\s+\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s+['"]leaflet['"]/)
    expect(codeOnly).not.toMatch(
      /import\s*\{[^}]*\b(?:map|tileLayer|marker|polyline|divIcon)\b[^}]*\}\s*from\s*['"]leaflet['"]/
    )
    expect(codeOnly).toMatch(/import\s+type\s*\{[\s\S]*?\bMap\s+as\s+LeafletMap/)
    // Runtime dynamic import only (type-level typeof import('leaflet') may also appear)
    const dynamicImportRe = /await\s+import\(['"]leaflet['"]\)/g
    const dynamicHits = [...codeOnly.matchAll(dynamicImportRe)]
    expect(dynamicHits).toHaveLength(1)
    const importIdx = dynamicHits[0].index ?? -1
    expect(importIdx).toBeGreaterThanOrEqual(0)
    const neighborhood = codeOnly.slice(Math.max(0, importIdx - 600), importIdx + 700)
    expect(neighborhood).toContain('resolveLeaflet')
    expect(neighborhood).toMatch(/let\s+cancelled\s*=\s*false/)
    expect(neighborhood).toContain('createdMap')
    expect(neighborhood).toContain('failLoad')
    const beforeImport = codeOnly.slice(0, importIdx)
    const effectStart = beforeImport.lastIndexOf('useEffect')
    expect(effectStart).toBeGreaterThanOrEqual(0)
    const fromEffect = codeOnly.slice(effectStart)
    const emptyDepsMatch = fromEffect.match(
      /^useEffect\s*\(\s*\(\)\s*=>[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/
    )
    expect(emptyDepsMatch).not.toBeNull()
    const initEffect = emptyDepsMatch![0]
    expect(initEffect).toContain("import('leaflet')")
    expect(initEffect).toContain('resolveLeaflet')
    expect(initEffect).toContain('safeRemoveMap(createdMap)')
    expect(initEffect).toContain('setMapReady(true)')
    expect(initEffect).toContain('setMapReady(false)')
    expect(initEffect).not.toContain('new ResizeObserver')
    expect(initEffect).not.toContain('model.linePositions')
    expect(codeOnly).toContain('Map failed to load')
    expect(codeOnly).toContain('route-map-load-error')
    expect(codeOnly).toContain('ref={containerRef}')
    expect(codeOnly).toMatch(/loadError[\s\S]*route-map-load-error|route-map-load-error[\s\S]*loadError/)
  })

  it('hides idle/calculating chrome when map canvas load fails', () => {
    const card = read(cardPath)
    expect(card).toContain('mapLoadFailed')
    expect(card).toContain('onLoadError')
    expect(card).toContain('onStyleLoaded')
    expect(card).toContain('mapStyleLoaded')
    // Idle hint only after style ready (no dual-stack with tiles loading)
    expect(card).toContain('isIdleEmpty && !mapLoadFailed && mapStyleLoaded')
    expect(card).toContain('showCalculating')
    expect(card).toContain('isCalculating && !mapLoadFailed')
    expect(card).toContain("mapLoadFailed\n    ? 'Map failed to load'")
  })

  it('syncs markers, polyline, and guards short line; ResizeObserver invalidates only', () => {
    const source = read(mapPath)
    expect(source).toContain('cancelled')
    expect(source).toContain('line.length >= 2')
    expect(source).toContain('L.polyline')
    expect(source).toContain('L.marker')
    expect(source).toContain('L.divIcon')
    expect(source).toContain('ROUTE_MAP_ROLE_HEX')
    expect(source).toContain('new ResizeObserver')
    expect(source).toContain('mapRef.current?.invalidateSize()')
    // Resize must not re-fit — anchor on constructor, not file-header mentions
    const resizeStart = source.indexOf('new ResizeObserver')
    expect(resizeStart).toBeGreaterThanOrEqual(0)
    const resizeFn = source.slice(resizeStart, source.indexOf('ro.observe', resizeStart))
    expect(resizeFn).toContain('.invalidateSize()')
    expect(resizeFn).not.toContain('fitToStops')
  })

  it('invalidates size on ready and after mapReady (immediate + two rAF follow-ups)', () => {
    const source = read(mapPath)
    expect(source).toContain('scheduleMapInvalidate')
    expect(source).toContain('cancelRafIds')
    expect(source).toContain('cancelAnimationFrame')
    expect(source).toContain('requestAnimationFrame')
    expect(source).toContain('map.invalidateSize()')
    const fnStart = source.indexOf('function scheduleMapInvalidate')
    expect(fnStart).toBeGreaterThanOrEqual(0)
    const fnBody = source.slice(fnStart, fnStart + 900)
    expect(fnBody).toMatch(
      /map\.invalidateSize\(\)[\s\S]*requestAnimationFrame\([\s\S]*map\.invalidateSize\(\)[\s\S]*requestAnimationFrame\([\s\S]*map\.invalidateSize\(\)/
    )
    expect(source).toMatch(/onReady[\s\S]*cancelled[\s\S]*mapRef\.current !== map/)
    expect(source).toMatch(/onReady[\s\S]*scheduleMapInvalidate/)
    expect(source).toMatch(/scheduleMapInvalidate\(mapRef/)
    expect(source).toContain('[mapReady, loadError]')
  })

  it('shows Loading map tiles overlay until ready; permanent fail uses Map failed to load', () => {
    const source = read(mapPath)
    expect(source).toContain('Loading map tiles…')
    expect(source).toContain('route-map-tiles-loading')
    expect(source).toContain('styleLoaded')
    expect(source).toContain('Map failed to load')
    expect(source).toContain('route-map-load-error')
    expect(source).toContain('!loadError && !styleLoaded')
    expect(source).toContain('role="status"')
    expect(source).toContain('aria-live="polite"')
    // Strict Mode cleanup resets sticky load error
    expect(source).toContain('loadErrorOnceRef.current = false')
    expect(source).toContain('setLoadError(null)')
  })

  it('uses whenReady for style-loaded contract (card idle hint)', () => {
    const source = read(mapPath)
    expect(source).toContain('whenReady')
    expect(source).toContain('onStyleLoaded')
    expect(source).toContain('setStyleLoaded(true)')
  })

  it('resets empty stops camera and handles near-zero bounds', () => {
    const source = read(mapPath)
    expect(source).toContain('DEFAULT_CENTER')
    expect(source).toContain('NEAR_ZERO_BOUNDS_DEG')
    expect(source).toContain('stops.length === 0')
    expect(source).toContain('setView')
  })

  it('keeps LatLon [lat,lon] for Leaflet polyline/markers', () => {
    const source = read(mapPath)
    expect(source).toContain('latLonToLatLng')
    expect(source).toContain('line.map(latLonToLatLng)')
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

  it('does not ship MapLibre worker helpers or public worker assets', () => {
    const { existsSync } = require('fs') as typeof import('fs')
    expect(existsSync(path.join(process.cwd(), 'components', 'route-map', 'configureMaplibreWorker.ts'))).toBe(false)
    expect(existsSync(path.join(process.cwd(), 'components', 'route-map', 'resolveMaplibreModule.ts'))).toBe(false)
    expect(existsSync(path.join(process.cwd(), 'public', 'maplibre-gl-worker.mjs'))).toBe(false)
    expect(existsSync(path.join(process.cwd(), 'public', 'maplibre-gl-shared.mjs'))).toBe(false)
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
