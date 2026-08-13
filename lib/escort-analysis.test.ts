import { describe, expect, it } from 'vitest'
import { parseDimensionInput } from '@/lib/parse-dimension'
import type { StatePermitRule } from '@/types/permit'
import {
  analyzeEscortRequirements,
  BASELINE_HEIGHT_POLE_FT,
  BASELINE_HEIGHT_POLE_STRONG_FT,
  BASELINE_ONE_ESCORT_WIDTH_FT,
  hasValidEscortLoadDimensions,
} from './escort-analysis'

function baseRule(stateCode: string, overrides: Partial<StatePermitRule> = {}): StatePermitRule {
  return {
    state_code: stateCode,
    state_name: stateCode,
    legal_width_ft: 8.5,
    legal_height_ft: 13.5,
    legal_length_ft: 53,
    legal_weight_lbs: 80000,
    permit_threshold_width_ft: 8.5,
    permit_threshold_height_ft: 13.5,
    permit_threshold_length_ft: 53,
    permit_threshold_weight_lbs: 80000,
    ...overrides,
  }
}

describe('hasValidEscortLoadDimensions', () => {
  it('rejects non-finite dimensions', () => {
    expect(hasValidEscortLoadDimensions({ width: Infinity, length: 74, height: 13.5, weight: 80000 })).toBe(false)
    expect(hasValidEscortLoadDimensions({ width: 8.5, length: 74, height: NaN, weight: 80000 })).toBe(false)
  })
})

describe('analyzeEscortRequirements', () => {
  it('12 width load flags escorts using baseline', () => {
    const widthFt = parseDimensionInput("12'7")!.feetDecimal

    const result = analyzeEscortRequirements({
      routeCorridor: ['NE', 'SD'],
      load: { width: widthFt, length: 74, height: 13.5, weight: 80000 },
      ruleMap: new Map([
        ['NE', baseRule('NE')],
        ['SD', baseRule('SD', { escort_threshold_width_ft: 12 })],
      ]),
      highways: ['I-80 (entry 41.1,-96.0 exit 43.2,-99.4)', 'I-29'],
    })

    expect(result.escortRequiredStates).toEqual(['NE', 'SD'])
    expect(result.escortDetails.every((d) => d.escortCount === 1)).toBe(true)
    expect(result.escortDetails.every((d) => d.requirementLevel === 'may_require')).toBe(true)
    expect(result.escortDetails.every((d) => d.positions.includes('chase'))).toBe(true)
    expect(result.escortWarnings.every((w) => !w.includes('(on '))).toBe(true)
  })

  it('15 height load flags height poles and escorts', () => {
    const heightFt = parseDimensionInput("15'8")!.feetDecimal

    const result = analyzeEscortRequirements({
      routeCorridor: ['NE'],
      load: { width: 8.5, length: 74, height: heightFt, weight: 80000 },
      ruleMap: new Map([['NE', baseRule('NE')]]),
      highways: ['I-80'],
    })

    expect(result.escortRequiredStates).toEqual(['NE'])
    expect(result.escortDetails[0].heightPoleRecommended).toBe(true)
    expect(result.escortDetails[0].heightPoleLevel).toBe('required')
    expect(result.escortDetails[0].escortCount).toBe(1)
  })

  it('width 14 or length 110 flags 2+ escorts required with lead+chase', () => {
    const wide = parseDimensionInput("14'0")!.feetDecimal

    const wideResult = analyzeEscortRequirements({
      routeCorridor: ['TX'],
      load: { width: wide, length: 74, height: 13.5, weight: 80000 },
      ruleMap: new Map([['TX', baseRule('TX', { escort_threshold_width_ft: 14 })]]),
    })
    expect(wideResult.escortDetails[0].escortCount).toBe(2)
    expect(wideResult.escortDetails[0].requirementLevel).toBe('required')
    expect(wideResult.escortDetails[0].positions).toEqual(['lead', 'chase'])

    const longResult = analyzeEscortRequirements({
      routeCorridor: ['WY'],
      load: { width: 8.5, length: 110, height: 13.5, weight: 80000 },
      ruleMap: new Map([['WY', baseRule('WY')]]),
    })
    expect(longResult.escortDetails[0].escortCount).toBe(2)
    expect(longResult.escortDetails[0].requirementLevel).toBe('required')
  })

  it('respects state-specific escort width threshold', () => {
    const widthFt = parseDimensionInput("11'6")!.feetDecimal

    const result = analyzeEscortRequirements({
      routeCorridor: ['PA'],
      load: { width: widthFt, length: 74, height: 13.5, weight: 80000 },
      ruleMap: new Map([['PA', baseRule('PA', { escort_threshold_width_ft: 11 })]]),
    })

    expect(result.escortRequiredStates).toEqual(['PA'])
    expect(result.escortDetails[0].escortCount).toBe(1)
  })

  it('notes local-road context when single-state has no major highways', () => {
    const widthFt = parseDimensionInput("12'7")!.feetDecimal

    const result = analyzeEscortRequirements({
      routeCorridor: ['NE'],
      load: { width: widthFt, length: 74, height: 13.5, weight: 80000 },
      ruleMap: new Map([['NE', baseRule('NE')]]),
      highways: [],
    })

    expect(result.escortWarnings[0]).toMatch(/local\/non-interstate/)
    expect(result.escortDetails[0].roadClassHint).toBe('local')
    expect(result.escortDetails[0].requirementLevel).toBe('may_require')
  })

  it('includes highway context only for single-state corridors', () => {
    const widthFt = parseDimensionInput("12'7")!.feetDecimal

    const single = analyzeEscortRequirements({
      routeCorridor: ['NE'],
      load: { width: widthFt, length: 74, height: 13.5, weight: 80000 },
      ruleMap: new Map([['NE', baseRule('NE')]]),
      highways: ['I-80'],
    })
    expect(single.escortWarnings[0]).toMatch(/\(on I-80\)/)

    const multi = analyzeEscortRequirements({
      routeCorridor: ['NE', 'SD'],
      load: { width: widthFt, length: 74, height: 13.5, weight: 80000 },
      ruleMap: new Map([
        ['NE', baseRule('NE')],
        ['SD', baseRule('SD')],
      ]),
      highways: ['I-80'],
    })
    expect(multi.escortWarnings.every((w) => !w.includes('(on '))).toBe(true)
  })

  it('boundary: exactly 12 width triggers 1 escort', () => {
    const result = analyzeEscortRequirements({
      routeCorridor: ['NE'],
      load: {
        width: BASELINE_ONE_ESCORT_WIDTH_FT,
        length: 74,
        height: 13.5,
        weight: 80000,
      },
      ruleMap: new Map([['NE', baseRule('NE')]]),
    })

    expect(result.escortRequiredStates).toEqual(['NE'])
    expect(result.escortDetails[0].escortCount).toBe(1)
  })

  it('boundary: 14.5 height triggers height pole recommended', () => {
    const result = analyzeEscortRequirements({
      routeCorridor: ['NE'],
      load: { width: 8.5, length: 74, height: BASELINE_HEIGHT_POLE_FT, weight: 80000 },
      ruleMap: new Map([['NE', baseRule('NE')]]),
    })

    expect(result.escortDetails[0].heightPoleRecommended).toBe(true)
    expect(result.escortDetails[0].heightPoleLevel).toBe('recommended')
  })

  it('boundary: 15.5 height triggers height pole required', () => {
    const result = analyzeEscortRequirements({
      routeCorridor: ['NE'],
      load: { width: 8.5, length: 74, height: BASELINE_HEIGHT_POLE_STRONG_FT, weight: 80000 },
      ruleMap: new Map([['NE', baseRule('NE')]]),
    })

    expect(result.escortDetails[0].heightPoleLevel).toBe('required')
    expect(result.escortDetails[0].escortCount).toBe(1)
  })

  it('TX 15.8 height does not false-positive when state threshold is 16', () => {
    const heightFt = parseDimensionInput("15'8")!.feetDecimal

    const result = analyzeEscortRequirements({
      routeCorridor: ['TX'],
      load: { width: 8.5, length: 74, height: heightFt, weight: 80000 },
      ruleMap: new Map([['TX', baseRule('TX', { escort_threshold_height_ft: 16 })]]),
    })

    expect(result.escortRequiredStates).toEqual([])
  })

  it('does not flag escorts when load is within all thresholds', () => {
    const result = analyzeEscortRequirements({
      routeCorridor: ['NE', 'SD'],
      load: { width: 8.5, length: 74, height: 13.5, weight: 80000 },
      ruleMap: new Map([
        ['NE', baseRule('NE')],
        ['SD', baseRule('SD')],
      ]),
      highways: ['I-90'],
    })

    expect(result.escortRequiredStates).toEqual([])
    expect(result.escortDetails).toEqual([])
  })

  it('returns empty for non-finite load dimensions', () => {
    const result = analyzeEscortRequirements({
      routeCorridor: ['NE'],
      load: { width: Infinity, length: 74, height: 13.5, weight: 80000 },
      ruleMap: new Map([['NE', baseRule('NE')]]),
    })

    expect(result.escortRequiredStates).toEqual([])
  })

  it('uses structured escort_rules bands when present (LE + required lead)', () => {
    const widthFt = parseDimensionInput("16'0")!.feetDecimal
    const rule = baseRule('TX', {
      escort_rules: {
        source: 'test',
        bands: [
          {
            when: { minWidthFt: 16 },
            requirement: 'required',
            count: 2,
            positions: ['lead', 'chase'],
            types: ['civilian', 'law_enforcement'],
            notes: 'Superload width — LE often required by district.',
          },
        ],
      },
    })

    const result = analyzeEscortRequirements({
      routeCorridor: ['TX'],
      load: { width: widthFt, length: 80, height: 13.5, weight: 90000 },
      ruleMap: new Map([['TX', rule]]),
    })

    expect(result.escortDetails).toHaveLength(1)
    const d = result.escortDetails[0]
    expect(d.escortCount).toBe(2)
    expect(d.requirementLevel).toBe('required')
    expect(d.positions).toEqual(['lead', 'chase'])
    expect(d.escortTypes).toContain('law_enforcement')
    expect(d.notes).toMatch(/Superload/)
    expect(d.warning).toMatch(/LE/)
  })
})
