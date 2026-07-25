import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const componentPath = path.join(process.cwd(), 'components', 'AxleConfigurator.tsx')
const pagePath = path.join(process.cwd(), 'app', 'axle-optimizer', 'page.tsx')

function read(p: string) {
  return readFileSync(p, 'utf8')
}

describe('AxleConfigurator source locks', () => {
  it('is a client component with SVG + save + multi-state controls', () => {
    const source = read(componentPath)
    expect(source).toMatch(/^'use client'/)
    expect(source).toContain('calculateAxleGroups')
    expect(source).toContain('<svg')
    expect(source).toContain('Save Config')
    expect(source).toContain('AXLE_OPTIMIZER_STATE_CODES')
    expect(source).toContain('/api/axle-optimize')
    expect(source).toContain('Voice (coming soon)')
    expect(source).toContain('Why 96 inches?')
  })

  it('supports lift toggle and add/remove axles', () => {
    const source = read(componentPath)
    expect(source).toContain('lifted')
    expect(source).toContain('Add axle')
    expect(source).toContain('Remove')
  })

  it('loads saved configs list and keeps configId for update', () => {
    const source = read(componentPath)
    expect(source).toContain('refreshSavedList')
    expect(source).toContain('loadConfig')
    expect(source).toContain('savedConfigs')
    expect(source).toContain('setConfigId')
    expect(source).toContain('Update Config')
    expect(source).toContain('method: \'DELETE\'')
    expect(source).toContain('setPointerCapture')
    expect(source).not.toContain('onPointerLeave')
  })

  it('restores selected states via helper and disclaims soft permit band', () => {
    const source = read(componentPath)
    expect(source).toContain('restoreSelectedStatesFromSaved')
    expect(source).toContain('planner estimate only')
    expect(source).toContain('MAX_AXLES')
    expect(source).toContain('MAX_POSITION_IN')
    expect(source).toContain('federal Interstate defaults only')
  })
})

describe('Axle optimizer page source locks', () => {
  it('auth-gates with AppHeader and does not mount configurator without user', () => {
    const source = read(pagePath)
    expect(source).toMatch(/^'use client'/)
    expect(source).toContain('AppHeader')
    expect(source).toContain('AxleConfigurator')
    expect(source).toContain("router.push('/login')")
    expect(source).toContain('getSession')
    expect(source).toMatch(/if \(loading \|\| !user\)/)
  })
})
