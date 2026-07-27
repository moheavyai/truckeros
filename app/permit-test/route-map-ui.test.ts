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

  it('maps routeProgress idle/calculating/ready/error into map status', () => {
    const source = readPermitPageSource()
    const start = source.indexOf('const routeMapModel = useMemo')
    expect(start).toBeGreaterThan(-1)
    const slice = source.slice(start, start + 1800)
    expect(slice).toContain("routeProgress === 'error'")
    expect(slice).toContain("routeProgress === 'calculating'")
    expect(slice).toContain("routeProgress === 'geocoding'")
    expect(slice).toContain("routeProgress === 'ready'")
    expect(slice).toContain("'idle'")
  })

  it('removes tall standalone route-progress hero chrome', () => {
    const source = readPermitPageSource()
    // Old tall progress banner copy
    expect(source).not.toContain('Best route and permit analysis run automatically when addresses are complete')
    // Old long Quick Route Glance panel
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
