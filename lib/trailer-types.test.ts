import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  DEFAULT_TRAILER_TYPES,
  MAX_CUSTOM_TRAILER_TYPES,
  TRAILER_TYPE_COUPLING_HINT,
  classifyTrailerRole,
  formatTrailerTypeLabel,
  getTrailerTypeOptions,
  isKingpinBoosterTrailerType,
  isRearPinTrailerType,
  mergeTrailerTypeOptions,
  normalizeTrailerTypeLabel,
  saveCustomTrailerType,
  CUSTOM_TRAILER_TYPES_STORAGE_KEY,
} from './trailer-types'

describe('normalize / format', () => {
  it('normalizes whitespace', () => {
    expect(normalizeTrailerTypeLabel('  step   deck ')).toBe('step deck')
  })

  it('formats labels and preserves RGN', () => {
    expect(formatTrailerTypeLabel('rgn')).toBe('RGN')
    expect(formatTrailerTypeLabel('step deck')).toBe('Step Deck')
    expect(formatTrailerTypeLabel('FLIP')).toBe('Flip')
  })
})

describe('classifyTrailerRole', () => {
  it('classifies defaults', () => {
    expect(classifyTrailerRole('Flatbed')).toBe('main')
    expect(classifyTrailerRole('Step Deck')).toBe('main')
    expect(classifyTrailerRole('Double Drop')).toBe('main')
    expect(classifyTrailerRole('RGN')).toBe('main')
    expect(classifyTrailerRole('Jeep')).toBe('jeep')
    expect(classifyTrailerRole('Flip')).toBe('flip')
    expect(classifyTrailerRole('Stinger')).toBe('stinger')
  })

  it('aliases booster and dolly to jeep role', () => {
    expect(classifyTrailerRole('Booster')).toBe('jeep')
    expect(classifyTrailerRole('converter dolly')).toBe('jeep')
    expect(classifyTrailerRole('jeep dolly')).toBe('jeep')
  })

  it('is tolerant of casing and extra words', () => {
    expect(classifyTrailerRole('jeep dollie')).toBe('jeep')
    expect(classifyTrailerRole('Flip Axle')).toBe('flip')
    expect(classifyTrailerRole('removable gooseneck')).toBe('main')
    expect(classifyTrailerRole('Stretch RGN')).toBe('main')
    expect(classifyTrailerRole('rgn trailer')).toBe('main')
  })

  it('rear pin vs kingpin helpers', () => {
    expect(isRearPinTrailerType('Flip')).toBe(true)
    expect(isRearPinTrailerType('Stinger')).toBe(true)
    expect(isRearPinTrailerType('Jeep')).toBe(false)
    expect(isKingpinBoosterTrailerType('Jeep')).toBe(true)
  })
})

describe('mergeTrailerTypeOptions', () => {
  it('dedupes case-insensitively with defaults first', () => {
    const merged = mergeTrailerTypeOptions(DEFAULT_TRAILER_TYPES, ['flatbed', 'Stretch RGN', 'rgn'])
    expect(merged[0]).toBe('Flatbed')
    expect(merged.filter((t) => t.toLowerCase() === 'flatbed')).toHaveLength(1)
    expect(merged.filter((t) => t.toLowerCase() === 'rgn')).toHaveLength(1)
    expect(merged).toContain('Stretch RGN')
  })
})

describe('localStorage custom list', () => {
  const store: Record<string, string> = {}

  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
    })
  })

  it('saves new custom types and surfaces them in options', () => {
    expect(saveCustomTrailerType('Stretch RGN')).toBe('Stretch RGN')
    expect(store[CUSTOM_TRAILER_TYPES_STORAGE_KEY]).toContain('Stretch RGN')
    const opts = getTrailerTypeOptions()
    expect(opts).toContain('Stretch RGN')
    expect(opts).toContain('Flatbed')
  })

  it('does not duplicate defaults into custom storage', () => {
    saveCustomTrailerType('flatbed')
    expect(store[CUSTOM_TRAILER_TYPES_STORAGE_KEY] || '[]').not.toMatch(/Flatbed/i)
  })

  it('caps custom list at MAX_CUSTOM_TRAILER_TYPES', () => {
    for (let i = 0; i < MAX_CUSTOM_TRAILER_TYPES + 5; i++) {
      saveCustomTrailerType(`Custom Type ${i}`)
    }
    const parsed = JSON.parse(store[CUSTOM_TRAILER_TYPES_STORAGE_KEY] || '[]') as string[]
    expect(parsed.length).toBe(MAX_CUSTOM_TRAILER_TYPES)
    // Oldest dropped; newest remains
    expect(parsed).toContain(formatTrailerTypeLabel(`Custom Type ${MAX_CUSTOM_TRAILER_TYPES + 4}`))
    expect(parsed).not.toContain(formatTrailerTypeLabel('Custom Type 0'))
  })
})

describe('UI hint constant', () => {
  it('documents flip/stinger vs jeep coupling', () => {
    expect(TRAILER_TYPE_COUPLING_HINT.toLowerCase()).toContain('rgn')
    expect(TRAILER_TYPE_COUPLING_HINT.toLowerCase()).toContain('jeep')
    expect(TRAILER_TYPE_COUPLING_HINT.toLowerCase()).toContain('flip')
  })
})
