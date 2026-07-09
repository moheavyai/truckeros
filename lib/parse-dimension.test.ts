import { describe, expect, it } from 'vitest'
import { formatDimensionDisplay, formatLoadDisplay } from './parse-dimension'

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