import { describe, expect, it } from 'vitest'
import { formatLicensePlateDisplay } from './license-plate'
import { normalizeLicensePlateState, US_STATE_OPTIONS } from './us-states'

describe('normalizeLicensePlateState', () => {
  it('accepts valid 2-letter US state codes', () => {
    expect(normalizeLicensePlateState('tx')).toBe('TX')
    expect(normalizeLicensePlateState(' CA ')).toBe('CA')
    expect(normalizeLicensePlateState('DC')).toBe('DC')
  })

  it('rejects invalid codes', () => {
    expect(normalizeLicensePlateState('')).toBeNull()
    expect(normalizeLicensePlateState(null)).toBeNull()
    expect(normalizeLicensePlateState('XX')).toBeNull()
    expect(normalizeLicensePlateState('Texas')).toBeNull()
    expect(normalizeLicensePlateState('T')).toBeNull()
  })
})

describe('formatLicensePlateDisplay', () => {
  it('formats plate with state', () => {
    expect(formatLicensePlateDisplay('abc1234', 'tx')).toBe('ABC1234 (TX)')
  })

  it('returns plate only when state missing', () => {
    expect(formatLicensePlateDisplay('xyz99', null)).toBe('XYZ99')
  })

  it('returns state only when plate missing', () => {
    expect(formatLicensePlateDisplay(null, 'ny')).toBe('NY')
  })

  it('returns empty string when both missing', () => {
    expect(formatLicensePlateDisplay('', '')).toBe('')
  })
})

describe('US_STATE_OPTIONS', () => {
  it('includes all 51 jurisdictions sorted by name', () => {
    expect(US_STATE_OPTIONS).toHaveLength(51)
    expect(US_STATE_OPTIONS[0].name <= US_STATE_OPTIONS[1].name).toBe(true)
    expect(US_STATE_OPTIONS.some((o) => o.code === 'TX')).toBe(true)
  })
})