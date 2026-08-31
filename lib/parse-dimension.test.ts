import { describe, expect, it } from 'vitest'
import {
  formatDimensionDisplay,
  formatLoadDisplay,
  implausibleHeightHint,
  isImplausibleHeightFeet,
  parseDimensionInput,
} from './parse-dimension'

describe('formatDimensionDisplay', () => {
  it('rounds decimal feet to nearest inch without repeating decimals', () => {
    expect(formatDimensionDisplay(11.91666)).toBe(`11' 11"`)
    expect(formatDimensionDisplay(13.3333)).toBe(`13' 4"`)
    expect(formatDimensionDisplay(13.5)).toBe(`13' 6"`)
    expect(formatDimensionDisplay(67)).toBe(`67' 0"`)
    expect(formatDimensionDisplay(12 + 7 / 12)).toBe(`12' 7"`)
  })

  it('returns empty string for zero or negative values', () => {
    expect(formatDimensionDisplay(0)).toBe('')
    expect(formatDimensionDisplay(-1)).toBe('')
  })
})

describe('formatLoadDisplay', () => {
  it('formats weight and dimensions for history display', () => {
    const display = formatLoadDisplay({
      weightLbs: 60000,
      lengthFt: 67,
      widthFt: 8.5,
      heightFt: 13.5,
    })
    expect(display.weight).toBe('60,000 lbs')
    expect(display.length).toBe(`67' 0"`)
    expect(display.width).toBe(`8' 6"`)
    expect(display.height).toBe(`13' 6"`)
    expect(display.dimensionsLine).toBe(`67' 0" × 8' 6" × 13' 6"`)
  })

  it('uses dashes for missing values', () => {
    const display = formatLoadDisplay({ weightLbs: 0, lengthFt: null })
    expect(display.weight).toBe('—')
    expect(display.dimensionsLine).toBe('—')
  })
})

describe('implausible height warning', () => {
  it('does not flag typical OSOW heights', () => {
    expect(isImplausibleHeightFeet(13.5)).toBe(false)
    expect(isImplausibleHeightFeet(20)).toBe(false)
  })

  it('flags heights above 20 feet including a bare 60', () => {
    expect(isImplausibleHeightFeet(20.1)).toBe(true)
    expect(isImplausibleHeightFeet(60)).toBe(true)
  })

  it('explains that bare 60 is 60 feet, not 60 inches', () => {
    const hint = implausibleHeightHint(60)
    expect(hint).toMatch(/60 inches/)
    expect(hint).toMatch(/5' 0"/)
  })

  it('does not change parse rules: bare 60 is 60 feet', () => {
    expect(parseDimensionInput('60')?.feetDecimal).toBe(60)
  })
})