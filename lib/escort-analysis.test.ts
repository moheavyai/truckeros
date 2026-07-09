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
  it('12\'7" width load flags escorts in states using baseline width threshold', () => {
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
    expect(result.escortWarnings.some((w) => w.startsWith('NE: 1 escort'))).toBe(true)
    expect(result.escortWarnings.some((w) => w.startsWith('SD: 1 escort'))).toBe(true)
    expect(result.escortDetails.every((d) => d.escortCount === 1)).toBe(true)
    expect(result.escortWarnings.every((w) => !w.includes('(on '))).toBe(true)
  })

  it('15\'8" height load flags height poles and escorts', () => {
    const heightFt = parseDimensionInput("15'8")!.feetDecimal

    const result = analyzeEscortRequirements({
      routeCorridor: ['NE'],
      load: { width: 8.5, length: 74, height: heightFt, weight: 80000 },
      ruleMap: new Map([['NE', baseRule('NE')]]),
      highways: ['I-80'],
    })

    expect(result.escortRequiredStates).toEqual(['NE'])
    expect(result.escortWarnings[0]).toMatch(/NE:.*height pole recommended/i)
    expect(result.escortWarnings[0]).toMatch(/1 escort recommended/i)
    expect(result.escortDetails[0].heightPoleRecommended).toBe(true)
  })

  it('width ≥ 14\'0" or length ≥ 110\' flags 2+ escorts', () => {
    const wide = parseDimensionInput("14'0")!.feetDecimal
    const long = 110

    const wideResult = analyzeEscortRequirements({
      routeCorridor: ['TX'],
      load: { width: wide, length: 74, height: 13.5, weight: 80000 },
      ruleMap: new Map([['TX', baseRule('TX', { escort_threshold_width_ft: 14 })]]),
    })
    expect(wideResult.escortDetails[0].escortCount).toBe(2)
    expect(wideResult.escortWarnings[0]).toMatch(/2\+ escorts required/)

    const longResult = analyzeEscortRequirements({
      routeCorridor: ['WY'],
      load: { width: 8.5, length: long, height: 13.5, weight: 80000 },
      ruleMap: new Map([['WY', baseRule('WY')]]),
    })
    expect(longResult.escortDetails[0].escortCount).toBe(2)
    expect(longResult.escortWarnings[0]).toMatch(/2\+ escorts required/)
  })

  it('respects state-specific escort width threshold when stricter than baseline', () => {
    const widthFt = parseDimensionInput("11'6")!.feetDecimal

    const result = analyzeEscortRequirements({
      routeCorridor: ['PA'],
      load: { width: widthFt, length: 74, height: 13.5, weight: 80000 },
      ruleMap: new Map([
        ['PA', baseRule('PA', { escort_threshold_width_ft: 11 })],
      ]),
    })

    expect(result.escortRequiredStates).toEqual(['PA'])
    expect(result.escortDetails[0].escortCount).toBe(1)
  })

  it('notes local-road context when single-state corridor has no major highways', () => {
    const widthFt = parseDimensionInput("12'7")!.feetDecimal

    const result = analyzeEscortRequirements({
      routeCorridor: ['NE'],
      load: { width: widthFt, length: 74, height: 13.5, weight: 80000 },
      ruleMap: new Map([['NE', baseRule('NE')]]),
      highways: [],
    })

    expect(result.escortWarnings[0]).toMatch(/local\/non-interstate/)
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

  it('boundary: exactly 12\'0" width triggers 1 escort at baseline', () => {
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

  it('boundary: exactly 14\'6" height triggers height pole at baseline', () => {
    const result = analyzeEscortRequirements({
      routeCorridor: ['NE'],
      load: { width: 8.5, length: 74, height: BASELINE_HEIGHT_POLE_FT, weight: 80000 },
      ruleMap: new Map([['NE', baseRule('NE')]]),
    })

    expect(result.escortRequiredStates).toEqual(['NE'])
    expect(result.escortDetails[0].heightPoleRecommended).toBe(true)
  })

  it('boundary: exactly 15\'6" height triggers strong height tier at baseline', () => {
    const result = analyzeEscortRequirements({
      routeCorridor: ['NE'],
      load: { width: 8.5, length: 74, height: BASELINE_HEIGHT_POLE_STRONG_FT, weight: 80000 },
      ruleMap: new Map([['NE', baseRule('NE')]]),
    })

    expect(result.escortRequiredStates).toEqual(['NE'])
    expect(result.escortDetails[0].heightPoleRecommended).toBe(true)
    expect(result.escortDetails[0].escortCount).toBe(1)
  })

  it('TX 15\'8" height does not false-positive when state escort height threshold is 16\'', () => {
    const heightFt = parseDimensionInput("15'8")!.feetDecimal

    const result = analyzeEscortRequirements({
      routeCorridor: ['TX'],
      load: { width: 8.5, length: 74, height: heightFt, weight: 80000 },
      ruleMap: new Map([
        ['TX', baseRule('TX', { escort_threshold_height_ft: 16 })],
      ]),
    })

    expect(result.escortRequiredStates).toEqual([])
    expect(result.escortWarnings).toEqual([])
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
    expect(result.escortWarnings).toEqual([])
    expect(result.escortDetails).toEqual([])
  })

  it('returns empty result for non-finite load dimensions', () => {
    const result = analyzeEscortRequirements({
      routeCorridor: ['NE'],
      load: { width: Infinity, length: 74, height: 13.5, weight: 80000 },
      ruleMap: new Map([['NE', baseRule('NE')]]),
    })

    expect(result.escortRequiredStates).toEqual([])
    expect(result.escortWarnings).toEqual([])
  })
})