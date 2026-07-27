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

  it('loads maplibre-gl via dynamic import (no top-level default value import)', () => {
    // webpack/Next interop leaves default value imports of maplibre-gl undefined at runtime
    const source = read(mapPath)
    // Strip line + block comments so assertions do not match documentation only
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    // Ban value imports of maplibre-gl under any binding name (default / namespace).
    // Type-only `import type { Map as MaplibreMap }` must still pass.
    expect(codeOnly).not.toMatch(/import\s+[A-Za-z_$][\w$]*\s+from\s+['"]maplibre-gl['"]/)
    expect(codeOnly).not.toMatch(/import\s+\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s+['"]maplibre-gl['"]/)
    // Named value import (no `type` keyword between import and `{`)
    expect(codeOnly).not.toMatch(
      /import\s*\{[^}]*\b(?:Map|Marker|Popup|NavigationControl|LngLatBounds)\b[^}]*\}\s*from\s*['"]maplibre-gl['"]/
    )
    expect(codeOnly).toMatch(/import\s+type\s*\{[\s\S]*?\bMap\s+as\s+MaplibreMap/)
    // Dynamic import must live in the mount-once init useEffect (empty deps).
    // Anchor on non-comment code only — comments are stripped from codeOnly above.
    const dynamicImportRe = /import\(['"]maplibre-gl['"]\)/g
    const dynamicHits = [...codeOnly.matchAll(dynamicImportRe)]
    expect(dynamicHits).toHaveLength(1)
    const importIdx = dynamicHits[0].index ?? -1
    expect(importIdx).toBeGreaterThanOrEqual(0)
    // Neighborhood of the call: await import + resolve + cancel flag (init path markers)
    const neighborhood = codeOnly.slice(Math.max(0, importIdx - 600), importIdx + 700)
    expect(neighborhood).toMatch(/await\s+import\(['"]maplibre-gl['"]\)/)
    expect(neighborhood).toContain('resolveMaplibreModule')
    expect(neighborhood).toMatch(/let\s+cancelled\s*=\s*false/)
    expect(neighborhood).toContain('createdMap')
    expect(neighborhood).toContain('failLoad')
    // Enclosing useEffect with empty dependency array (init-once, not ResizeObserver/model sync)
    const beforeImport = codeOnly.slice(0, importIdx)
    const effectStart = beforeImport.lastIndexOf('useEffect')
    expect(effectStart).toBeGreaterThanOrEqual(0)
    // Take from that useEffect through its empty-deps closer (survive comment-strip)
    const fromEffect = codeOnly.slice(effectStart)
    const emptyDepsMatch = fromEffect.match(
      /^useEffect\s*\(\s*\(\)\s*=>[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/
    )
    expect(emptyDepsMatch).not.toBeNull()
    const initEffect = emptyDepsMatch![0]
    expect(initEffect).toContain("import('maplibre-gl')")
    expect(initEffect).toContain('resolveMaplibreModule')
    expect(initEffect).toContain('safeRemoveMap(createdMap)')
    expect(initEffect).toContain('setMapReady(true)')
    expect(initEffect).toContain('setMapReady(false)')
    // Not the ResizeObserver or model-sync effects
    expect(initEffect).not.toContain('ResizeObserver')
    expect(initEffect).not.toContain('model.linePositions')
    expect(codeOnly).toContain('Map failed to load')
    expect(codeOnly).toContain('route-map-load-error')
    // Error is overlay — map container ref stays mounted
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

  it('resizes on style load and after mapReady (immediate + two rAF follow-ups)', () => {
    const source = read(mapPath)
    expect(source).toContain('scheduleMapResize')
    expect(source).toContain('cancelRafIds')
    expect(source).toContain('cancelAnimationFrame')
    expect(source).toContain('requestAnimationFrame')
    expect(source).toContain('map.resize()')
    // scheduleMapResize body: immediate resize then nested rAF pair (3 total)
    const fnStart = source.indexOf('function scheduleMapResize')
    expect(fnStart).toBeGreaterThanOrEqual(0)
    const fnBody = source.slice(fnStart, fnStart + 900)
    expect(fnBody).toMatch(/map\.resize\(\)[\s\S]*requestAnimationFrame\([\s\S]*map\.resize\(\)[\s\S]*requestAnimationFrame\([\s\S]*map\.resize\(\)/)
    // on load path with cancelled / instance guard
    expect(source).toMatch(/onLoad[\s\S]*cancelled[\s\S]*mapRef\.current !== map/)
    expect(source).toMatch(/onLoad[\s\S]*scheduleMapResize/)
    // once after mapReady; rAF cancelled on effect cleanup
    expect(source).toMatch(/scheduleMapResize\(mapRef/)
    expect(source).toContain('[mapReady, loadError]')
  })

  it('falls back once to demotiles; ignores residual errors until transition settles', () => {
    const source = read(mapPath)
    expect(source).toContain('https://demotiles.maplibre.org/style.json')
    expect(source).toContain('FALLBACK_MAP_STYLE')
    expect(source).toContain('styleFallbackTriedRef')
    expect(source).toContain('styleFallbackTransitionRef')
    expect(source).toContain('setStyle(FALLBACK_MAP_STYLE)')
    expect(source).toContain("console.info('[RouteMap] using map style'")
    expect(source).toContain('falling back to demotiles')
    // Branch order: first error → setStyle + return; transition residual → return; then failLoad
    expect(source).toMatch(
      /!styleFallbackTriedRef\.current[\s\S]*setStyle\(FALLBACK_MAP_STYLE\)[\s\S]*return[\s\S]*styleFallbackTransitionRef\.current[\s\S]*return[\s\S]*failLoad\(/
    )
    // Strict Mode cleanup resets sticky load error
    expect(source).toContain('loadErrorOnceRef.current = false')
    expect(source).toContain('setLoadError(null)')
    // trim whitespace-only env style URL
    expect(source).toMatch(/NEXT_PUBLIC_MAP_STYLE_URL\.trim\(\)/)
  })

  it('shows Loading map tiles overlay until style load; permanent fail uses Map failed to load', () => {
    const source = read(mapPath)
    expect(source).toContain('Loading map tiles…')
    expect(source).toContain('route-map-tiles-loading')
    expect(source).toContain('styleLoaded')
    expect(source).toContain('Map failed to load')
    expect(source).toContain('route-map-load-error')
    // Overlay exclusivity gate
    expect(source).toContain('!loadError && !styleLoaded')
    expect(source).toContain('role="status"')
    expect(source).toContain('aria-live="polite"')
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
