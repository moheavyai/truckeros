import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

describe('DimensionInput focus stability', () => {
  it('skips parent value sync while the field is focused', () => {
    const filePath = path.join(process.cwd(), 'components', 'DimensionInput.tsx')
    const source = readFileSync(filePath, 'utf8')

    expect(source).toContain('focusedRef')
    expect(source).toContain('if (focusedRef.current) return')
    expect(source).toContain('lastCommittedRef')
  })
})