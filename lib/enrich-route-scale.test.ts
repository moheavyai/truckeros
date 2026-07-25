import { describe, expect, it, vi } from 'vitest'
import {
  distributeWeightByGroupLimits,
  resolveAxleGroupsFromConfig,
} from './axle-groups'
import { enrichRouteOptionWithScale } from './enrich-route-scale'
import type { StatePermitRule } from '@/types/permit'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
  },
}))

function rule(code: string, legal: number): StatePermitRule {
  return {
    state_code: code,
    state_name: code,
    legal_width_ft: 8.5,
    legal_height_ft: 13.5,
    legal_length_ft: 53,
    legal_weight_lbs: legal,
    permit_threshold_width_ft: 8.5,
    permit_threshold_height_ft: 13.5,
    permit_threshold_length_ft: 53,
    permit_threshold_weight_lbs: legal,
  }
}

describe('enrichRouteOptionWithScale', () => {
  it('attaches scale findings and axle group summary to a corridor option', () => {
    const summary = resolveAxleGroupsFromConfig({ axles: 5 })
    const option = enrichRouteOptionWithScale(
      {
        routeCorridor: ['TX'],
        notes: ['existing'],
        reasons: [],
        permitRequiredStates: [],
      },
      {
        weight: 200_000,
        axles: 5,
        axleWeights: [40_000, 40_000, 40_000, 40_000, 40_000],
      },
      new Map([['TX', rule('TX', 80_000)]]),
      summary
    )

    expect(option.axleGroupSummary).toMatch(/5 axles/)
    expect(option.scaleFindings?.length).toBeGreaterThan(0)
    expect(option.unableToScale).toBe(true)
    expect(option.corridorScaleFailedStates).toContain('TX')
    expect(option.notes?.some((n) => n.includes('Axle groups'))).toBe(true)
  })

  it('passes legal light load without scale failure', () => {
    const summary = resolveAxleGroupsFromConfig({ axles: 5 })
    const weights = distributeWeightByGroupLimits(summary.groups, 70_000)
    const option = enrichRouteOptionWithScale(
      { routeCorridor: ['TX'], notes: [], reasons: [], permitRequiredStates: [] },
      { weight: 70_000, axles: 5, axleWeights: weights },
      new Map([['TX', rule('TX', 80_000)]]),
      summary
    )
    expect(option.unableToScale).toBe(false)
    expect(option.corridorScaleFailedStates).toHaveLength(0)
  })
})
