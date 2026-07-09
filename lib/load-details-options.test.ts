import { describe, expect, it } from 'vitest'
import {
  clampNumberOfPieces,
  DEFAULT_LOADED_ARRANGEMENT,
  DEFAULT_MOVE_TYPE,
  DEFAULT_NUMBER_OF_PIECES,
  LOADED_ARRANGEMENT_OPTIONS,
  MAX_NUMBER_OF_PIECES,
  MOVE_TYPE_OPTIONS,
  formatNumberOfPiecesLabel,
  parseAndClampPieces,
  resolvePiecesForSubmit,
  sanitizeLoadedArrangement,
  sanitizeMoveType,
  sanitizeNumberOfPieces,
} from './load-details-options'

describe('load-details-options', () => {
  it('exposes expected defaults and option lists', () => {
    expect(DEFAULT_NUMBER_OF_PIECES).toBe(1)
    expect(DEFAULT_LOADED_ARRANGEMENT).toBe('side-by-side')
    expect(DEFAULT_MOVE_TYPE).toBe('hauled')
    expect(MAX_NUMBER_OF_PIECES).toBe(999)
    expect(LOADED_ARRANGEMENT_OPTIONS).toEqual(['side-by-side', 'end-to-end', 'stacked'])
    expect(MOVE_TYPE_OPTIONS).toEqual(['hauled', 'self-propelled', 'towed'])
  })

  it('clampNumberOfPieces enforces minimum of 1 and maximum cap', () => {
    expect(clampNumberOfPieces(0)).toBe(1)
    expect(clampNumberOfPieces(-3)).toBe(1)
    expect(clampNumberOfPieces(1)).toBe(1)
    expect(clampNumberOfPieces(2.7)).toBe(3)
    expect(clampNumberOfPieces(0.4)).toBe(1)
    expect(clampNumberOfPieces(Number.NaN)).toBe(1)
    expect(clampNumberOfPieces(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampNumberOfPieces(Number.NEGATIVE_INFINITY)).toBe(1)
    expect(clampNumberOfPieces(1500)).toBe(MAX_NUMBER_OF_PIECES)
  })

  it('parseAndClampPieces uses Number() and clamps on blur semantics', () => {
    expect(parseAndClampPieces('')).toBe(1)
    expect(parseAndClampPieces(' 2.6 ')).toBe(3)
    expect(parseAndClampPieces('abc')).toBe(1)
  })

  it('sanitizes enum values to allowlisted defaults', () => {
    expect(sanitizeLoadedArrangement('stacked')).toBe('stacked')
    expect(sanitizeLoadedArrangement('bogus')).toBe(DEFAULT_LOADED_ARRANGEMENT)
    expect(sanitizeMoveType('towed')).toBe('towed')
    expect(sanitizeMoveType(null)).toBe(DEFAULT_MOVE_TYPE)
    expect(sanitizeNumberOfPieces('12')).toBe(12)
    expect(sanitizeNumberOfPieces(undefined)).toBe(1)
  })

  it('formatNumberOfPiecesLabel omits invalid values without coercing', () => {
    expect(formatNumberOfPiecesLabel(3)).toBe('3 pieces')
    expect(formatNumberOfPiecesLabel(0)).toBeNull()
    expect(formatNumberOfPiecesLabel(null)).toBeNull()
    expect(formatNumberOfPiecesLabel('abc')).toBeNull()
  })

  it('resolvePiecesForSubmit prefers draft over committed form value', () => {
    expect(resolvePiecesForSubmit({ numberOfPieces: 1 }, '12')).toBe(12)
    expect(resolvePiecesForSubmit({ numberOfPieces: 5 }, null)).toBe(5)
    expect(resolvePiecesForSubmit({ numberOfPieces: 3 }, '')).toBe(1)
  })
})