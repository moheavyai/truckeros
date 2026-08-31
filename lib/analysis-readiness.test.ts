import { describe, expect, it } from 'vitest'
import { canRunRouteAnalysis, NO_TRACTOR_ANALYSIS_HINT } from './analysis-readiness'

describe('canRunRouteAnalysis', () => {
  it('requires at least one tractor', () => {
    expect(canRunRouteAnalysis({ tractorCount: 0 })).toBe(false)
    expect(canRunRouteAnalysis({ tractorCount: 1 })).toBe(true)
    expect(canRunRouteAnalysis({ tractorCount: 3 })).toBe(true)
  })

  it('exports the empty-fleet hint', () => {
    expect(NO_TRACTOR_ANALYSIS_HINT).toMatch(/tractor/i)
  })
})
