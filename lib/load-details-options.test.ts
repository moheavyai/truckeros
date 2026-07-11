import { describe, expect, it } from 'vitest'
import {
  applyNumberOfPiecesChange,
  clampNumberOfPieces,
  DEFAULT_LOADED_ARRANGEMENT,
  DEFAULT_MOVE_TYPE,
  DEFAULT_NUMBER_OF_PIECES,
  LOADED_ARRANGEMENT_OPTIONS,
  MAX_NUMBER_OF_PIECES,
  MOVE_TYPE_OPTIONS,
  MULTI_PIECE_DEFAULT_LOADED_ARRANGEMENT,
  formatNumberOfPiecesLabel,
  parseAndClampPieces,
  resolveLoadedArrangementForPieces,
  resolvePiecesAndArrangementForSubmit,
  resolvePiecesForSubmit,
  sanitizeLoadedArrangement,
  sanitizeMoveType,
  sanitizeNumberOfPieces,
} from './load-details-options'

describe('load-details-options', () => {
  it('exposes expected defaults and option lists', () => {
    expect(DEFAULT_NUMBER_OF_PIECES).toBe(1)
    expect(DEFAULT_LOADED_ARRANGEMENT).toBe('side-by-side')
    expect(MULTI_PIECE_DEFAULT_LOADED_ARRANGEMENT).toBe('end-to-end')
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
    // Empty / unset (pieces = 1, nothing selected) must not invent side-by-side
    expect(sanitizeLoadedArrangement('')).toBeNull()
    expect(sanitizeLoadedArrangement(null)).toBeNull()
    expect(sanitizeLoadedArrangement(undefined)).toBeNull()
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

  it('resolveLoadedArrangementForPieces defaults by piece count', () => {
    // Single piece: nothing selected
    expect(resolveLoadedArrangementForPieces(1, '')).toBe('')
    expect(resolveLoadedArrangementForPieces(1, 'end-to-end')).toBe('')
    expect(resolveLoadedArrangementForPieces(1, 'stacked')).toBe('')

    // Multi-piece with empty/invalid: pre-select end-to-end
    expect(resolveLoadedArrangementForPieces(2, '')).toBe('end-to-end')
    expect(resolveLoadedArrangementForPieces(5, null)).toBe('end-to-end')
    expect(resolveLoadedArrangementForPieces(3, 'bogus')).toBe('end-to-end')

    // Multi-piece with valid user choice: preserve
    expect(resolveLoadedArrangementForPieces(2, 'side-by-side')).toBe('side-by-side')
    expect(resolveLoadedArrangementForPieces(4, 'stacked')).toBe('stacked')
    expect(resolveLoadedArrangementForPieces(2, 'end-to-end')).toBe('end-to-end')
  })

  it('applyNumberOfPiecesChange syncs arrangement only when count changes', () => {
    // 1 → 2+: pre-select end-to-end from empty
    expect(applyNumberOfPiecesChange(1, 2, '')).toEqual({
      numberOfPieces: 2,
      loadedArrangement: 'end-to-end',
    })

    // 1 → 2+ with pre-selected valid arrangement: preserve (do not force end-to-end)
    expect(applyNumberOfPiecesChange(1, 3, 'stacked')).toEqual({
      numberOfPieces: 3,
      loadedArrangement: 'stacked',
    })

    // 2+ → 1: clear selection
    expect(applyNumberOfPiecesChange(3, 1, 'stacked')).toEqual({
      numberOfPieces: 1,
      loadedArrangement: '',
    })

    // Multi → multi: preserve user pick
    expect(applyNumberOfPiecesChange(2, 5, 'side-by-side')).toEqual({
      numberOfPieces: 5,
      loadedArrangement: 'side-by-side',
    })

    // Multi → multi empty/invalid → end-to-end
    expect(applyNumberOfPiecesChange(2, 4, '')).toEqual({
      numberOfPieces: 4,
      loadedArrangement: 'end-to-end',
    })
    expect(applyNumberOfPiecesChange(2, 4, 'bogus')).toEqual({
      numberOfPieces: 4,
      loadedArrangement: 'end-to-end',
    })

    // Re-commit same single-piece count: keep manual selection
    expect(applyNumberOfPiecesChange(1, 1, 'stacked')).toEqual({
      numberOfPieces: 1,
      loadedArrangement: 'stacked',
    })

    // Re-commit same multi count: keep selection
    expect(applyNumberOfPiecesChange(2, 2, 'stacked')).toEqual({
      numberOfPieces: 2,
      loadedArrangement: 'stacked',
    })

    // Same-count multi with empty stays empty (do not force end-to-end on re-blur)
    expect(applyNumberOfPiecesChange(2, 2, '')).toEqual({
      numberOfPieces: 2,
      loadedArrangement: '',
    })

    // Clamp boundaries when applying pieces change
    expect(applyNumberOfPiecesChange(1, 0, '')).toEqual({
      numberOfPieces: 1,
      loadedArrangement: '',
    })
    expect(applyNumberOfPiecesChange(1, Number.NaN, '')).toEqual({
      numberOfPieces: 1,
      loadedArrangement: '',
    })
    expect(applyNumberOfPiecesChange(1, 2.4, '')).toEqual({
      numberOfPieces: 2,
      loadedArrangement: 'end-to-end',
    })
    expect(applyNumberOfPiecesChange(5, 2.6, 'side-by-side')).toEqual({
      numberOfPieces: 3,
      loadedArrangement: 'side-by-side',
    })
  })

  it('resolvePiecesAndArrangementForSubmit flushes draft and syncs arrangement', () => {
    expect(
      resolvePiecesAndArrangementForSubmit(
        { numberOfPieces: 1, loadedArrangement: '' },
        '3'
      )
    ).toEqual({ numberOfPieces: 3, loadedArrangement: 'end-to-end' })

    expect(
      resolvePiecesAndArrangementForSubmit(
        { numberOfPieces: 2, loadedArrangement: 'stacked' },
        null
      )
    ).toEqual({ numberOfPieces: 2, loadedArrangement: 'stacked' })

    expect(
      resolvePiecesAndArrangementForSubmit(
        { numberOfPieces: 4, loadedArrangement: 'end-to-end' },
        '1'
      )
    ).toEqual({ numberOfPieces: 1, loadedArrangement: '' })
  })
})