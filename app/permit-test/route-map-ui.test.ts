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
  return source.slice(start, start + 2200)
}

describe('permit-test Route map v1 integration', () => {
  it('imports RouteMapCard and buildRouteMapModel from components/route-map', () => {
    const source = readPermitPageSource()
    expect(source).toContain("from '@/components/route-map'")
    expect(source).toContain('RouteMapCard')
    expect(source).toContain('buildRouteMapModel')
  })

  it('renders RouteMapCard wired to routeMapModel', () => {
    const source = readPermitPageSource()
    expect(source).toContain('const routeMapModel = useMemo')
    expect(source).toContain('<RouteMapCard model={routeMapModel}')
    expect(source).toContain('buildRouteMapModel({')
  })

  it('maps routeProgress matrix without sticky ready from leftover option', () => {
    const source = readPermitPageSource()
    const slice = routeMapModelSlice(source)
    expect(slice).toContain("routeProgress === 'error'")
    expect(slice).toContain("routeProgress === 'calculating'")
    expect(slice).toContain("routeProgress === 'geocoding'")
    expect(slice).toContain("routeProgress === 'ready'")
    expect(slice).toContain("'idle'")
    // Sticky-ready bug: must NOT force ready from hasRouteOption alone
    expect(slice).not.toContain('hasRouteOption')
    expect(slice).toMatch(/routeProgress === 'ready'\s*\?\s*'ready'/)
  })

  it('depends on geocode fingerprint, not full formData object', () => {
    const source = readPermitPageSource()
    expect(source).toContain('const routeMapFormKey = useMemo')
    const slice = routeMapModelSlice(source)
    expect(slice).toContain('routeMapFormKey')
    expect(slice).not.toMatch(/\}, \[agentResult, result, routeProgress, routeProgressDetail, formData\]\)/)
  })

  it('honors prefers-reduced-motion on post-ready scroll', () => {
    const source = readPermitPageSource()
    expect(source).toContain("prefers-reduced-motion: reduce")
    expect(source).toMatch(/behavior:\s*reduceMotion \? 'auto' : 'smooth'/)
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
