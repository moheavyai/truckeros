import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

describe('OverhangFeetInput', () => {
  it('is a plain manual number input without DimensionInput auto-format sync', () => {
    const filePath = path.join(process.cwd(), 'components', 'OverhangFeetInput.tsx')
    const source = readFileSync(filePath, 'utf8')

    expect(source).toContain('type="number"')
    expect(source).not.toContain('useEffect')
    expect(source).not.toContain('formatDimensionDisplay')
    expect(source).not.toContain('parseDimensionInput')
  })
})

describe('permit-test load overhang fields', () => {
  it('uses OverhangFeetInput for all three overhang fields (no DimensionInput)', () => {
    const filePath = path.join(process.cwd(), 'app', 'permit-test', 'page.tsx')
    const source = readFileSync(filePath, 'utf8')

    const section = source.slice(
      source.indexOf('Load Overhangs'),
      source.indexOf('Dynamic axle weights')
    )

    expect(section).toContain('OverhangFeetInput')
    expect(section.match(/OverhangFeetInput/g)?.length).toBe(3)
    expect(section).not.toContain('DimensionInput')
  })

  it('renders load overhangs in a collapsible details section collapsed by default', () => {
    const filePath = path.join(process.cwd(), 'app', 'permit-test', 'page.tsx')
    const source = readFileSync(filePath, 'utf8')

    const loadOverhangsIdx = source.indexOf('Load Overhangs')
    const section = source.slice(
      source.lastIndexOf('<details', loadOverhangsIdx),
      source.indexOf('Dynamic axle weights')
    )

    expect(section).toContain('<details')
    expect(section).toContain('<summary')
    expect(section).toContain('Load Overhangs')
    expect(section).not.toMatch(/<details[^>]*\sopen\b/)
  })

  it('does not auto-set overhang state inside envelope useEffect', () => {
    const filePath = path.join(process.cwd(), 'app', 'permit-test', 'page.tsx')
    const source = readFileSync(filePath, 'utf8')

    const effectStart = source.indexOf('const envelope = computeRoutingEnvelope({')
    const effectEnd = source.indexOf('}, [', effectStart)
    const effectBody = source.slice(effectStart, effectEnd)

    expect(effectBody).not.toMatch(/setLoadOverhang/)
  })
})