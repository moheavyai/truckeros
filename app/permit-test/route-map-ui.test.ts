/**
 * Permit Test integration: RouteMapCard replaces tall progress + Quick Route Glance.
 * Source inspection only (no WebGL).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const permitPagePath = path.join(process.cwd(), 'app', 'permit-test', 'page.tsx')

function readPermitPageSource() {
  return readFileSync(permitPagePath, 'utf8').replace(/\r\n/g, '\n')
}

function routeMapModelSlice(source: string) {
  const start = source.indexOf('const routeMapModel = useMemo')
  expect(start).toBeGreaterThan(-1)
  return source.slice(start, start + 1800)
}

describe('permit-test Route map v1 integration', () => {
  it('imports RouteMapCard, buildRouteMapModel, toRouteMapBuildInput', () => {
    const source = readPermitPageSource()
    expect(source).toContain("from '@/components/route-map'")
    expect(source).toContain('RouteMapCard')
    expect(source).toContain('buildRouteMapModel')
    expect(source).toContain('toRouteMapBuildInput')
    expect(source).toContain('ROUTE_MAP_CARD_EMBED_CLASS')
  })

  it('renders RouteMapCard with embed className and routeMapModel', () => {
    const source = readPermitPageSource()
    expect(source).toContain('const routeMapModel = useMemo')
    expect(source).toContain('<RouteMapCard model={routeMapModel}')
    expect(source).toContain('className={ROUTE_MAP_CARD_EMBED_CLASS}')
    expect(source).toContain('toRouteMapBuildInput({')
  })

  it('uses pure adapter with coordsReady/dimsReady demotion inputs', () => {
    const slice = routeMapModelSlice(readPermitPageSource())
    expect(slice).toContain('coordsReady')
    expect(slice).toContain('dimsReady')
    expect(slice).toContain('toRouteMapBuildInput')
    expect(slice).toContain('formSynced')
    expect(slice).not.toContain('hasRouteOption')
  })

  it('depends on geocode fingerprint + dims, not full formData object', () => {
    const source = readPermitPageSource()
    expect(source).toContain('const routeMapFormKey = useMemo')
    const slice = routeMapModelSlice(source)
    expect(slice).toContain('routeMapFormKey')
    expect(slice).toContain('formData.weight')
    expect(slice).not.toMatch(/\}, \[agentResult, result, routeProgress, routeProgressDetail, formData\]\)/)
  })

  it('honors prefers-reduced-motion on post-ready, reject, and Edit Request scroll', () => {
    const source = readPermitPageSource()
    expect(source).toContain("prefers-reduced-motion: reduce")
    // Analyze ready, reject, Edit Request
    const occurrences = source.split("behavior: reduceMotion ? 'auto' : 'smooth'").length - 1
    expect(occurrences).toBeGreaterThanOrEqual(3)
    expect(source).toContain('Edit Request')
  })

  it('resets routeProgress on reject and start over', () => {
    const source = readPermitPageSource()
    const start = source.indexOf('const handleRejectAndRestart')
    expect(start).toBeGreaterThan(-1)
    const slice = source.slice(start, start + 600)
    expect(slice).toContain("setRouteProgress('idle')")
  })

  it('removes tall standalone route-progress hero chrome', () => {
    const source = readPermitPageSource()
    expect(source).not.toContain('Best route and permit analysis run automatically when addresses are complete')
    expect(source).not.toContain('Quick Route Glance')
    expect(source).not.toContain('Preview Corridor & Fee')
    expect(source).not.toContain('Preview Corridor &amp; Fee')
  })

  it('does not change optimize-route payload construction (still posts optimize-route)', () => {
    const source = readPermitPageSource()
    expect(source).toContain("fetch('/api/optimize-route'")
    expect(source).toContain("optimizationMode: 'ortools'")
  })
})
