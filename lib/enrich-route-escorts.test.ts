import { describe, expect, it, vi } from 'vitest'
import { parseDimensionInput } from '@/lib/parse-dimension'
import type { StatePermitRule } from '@/types/permit'
import {
  enrichOrToolsResponseWithEscorts,
  enrichRouteOptionWithEscorts,
  loadStatePermitRuleMap,
} from './enrich-route-escorts'

const neRule: StatePermitRule = {
  state_code: 'NE',
  state_name: 'Nebraska',
  legal_width_ft: 8.5,
  legal_height_ft: 13.5,
  legal_length_ft: 53,
  legal_weight_lbs: 80000,
  permit_threshold_width_ft: 8.5,
  permit_threshold_height_ft: 13.5,
  permit_threshold_length_ft: 53,
  permit_threshold_weight_lbs: 80000,
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        in: vi.fn((_col: string, codes: string[]) =>
          Promise.resolve({
            data: codes.includes('NE') ? [neRule] : [],
            error: null,
          })
        ),
      })),
    })),
  },
}))

describe('enrich-route-escorts', () => {
  it('merges escort fields into a route option', () => {
    const widthFt = parseDimensionInput("12'7")!.feetDecimal
    const ruleMap = new Map([['NE', neRule]])

    const enriched = enrichRouteOptionWithEscorts(
      { routeCorridor: ['NE'], highways: ['I-80'] },
      { width: widthFt, length: 74, height: 13.5, weight: 80000 },
      ruleMap
    )

    expect(enriched.escortRequiredStates).toEqual(['NE'])
    expect(enriched.escortWarnings?.length).toBe(1)
    expect(enriched.escortDetails?.length).toBe(1)
  })

  it('enriches primary and alternatives from OR-Tools response shape', async () => {
    const widthFt = parseDimensionInput("12'7")!.feetDecimal

    const enriched = await enrichOrToolsResponseWithEscorts(
      {
        status: 'ok',
        primary: { routeCorridor: ['NE'], highways: ['I-80'] },
        alternatives: [{ routeCorridor: ['NE'], highways: ['I-80'] }],
      },
      { width: widthFt, length: 74, height: 13.5, weight: 80000 }
    )

    expect(enriched.primary?.escortRequiredStates).toEqual(['NE'])
    expect(enriched.alternatives?.[0]?.escortRequiredStates).toEqual(['NE'])
  })

  it('loads state rules for corridor states', async () => {
    const ruleMap = await loadStatePermitRuleMap(['NE'])
    expect(ruleMap.get('NE')?.state_code).toBe('NE')
  })
})