import { describe, expect, it } from 'vitest'
import {
  applyGeocodeToStop,
  buildGeocodeQuery,
  createEmptyStop,
  extractAddressFromGeocodeResult,
  extractStateCodeFromText,
  extractZipFromText,
  hasValidCoords,
  isStopReadyForGeocode,
  MAX_DROPS,
  normalizeDrops,
  syncDestinationFromDrops,
} from './location-stop'

describe('buildGeocodeQuery', () => {
  it('prefers natural-language query for business names', () => {
    expect(
      buildGeocodeQuery({
        id: '1',
        query: 'Case IH plant, Grand Island, NE',
        street: '',
        city: '',
        state: '',
        zip: '',
      })
    ).toBe('Case IH plant, Grand Island, NE')
  })

  it('normalizes highway tokens in query', () => {
    expect(
      buildGeocodeQuery({
        id: '1',
        query: 'West Plains Dickinson I94 Business Loop E',
        street: '',
        city: '',
        state: '',
        zip: '',
      })
    ).toContain('I-94 Business Loop East')
  })

  it('supports zip-only lookup', () => {
    expect(
      buildGeocodeQuery({
        id: '1',
        query: '58601',
        street: '',
        city: '',
        state: '',
        zip: '',
      })
    ).toBe('58601, United States')
  })

  it('composes structured parts when query is empty', () => {
    expect(
      buildGeocodeQuery({
        id: '1',
        query: '',
        street: '123 Main St',
        city: 'Minot',
        state: 'ND',
        zip: '58701',
      })
    ).toBe('123 Main St, Minot, ND, 58701, United States')
  })
})

describe('hasValidCoords', () => {
  it('rejects null and NaN coordinates', () => {
    expect(hasValidCoords(null, -101)).toBe(false)
    expect(hasValidCoords(48, null)).toBe(false)
    expect(hasValidCoords(undefined, -101)).toBe(false)
    expect(hasValidCoords(Number.NaN, -101)).toBe(false)
    expect(hasValidCoords(48, Number.NaN)).toBe(false)
  })

  it('accepts finite coordinates including zero', () => {
    expect(hasValidCoords(48.2, -101.3)).toBe(true)
    expect(hasValidCoords(-33.8, 151.2)).toBe(true)
    expect(hasValidCoords(0, -101)).toBe(true)
    expect(hasValidCoords(48, 0)).toBe(true)
  })
})

describe('isStopReadyForGeocode', () => {
  it('is ready for real-world business/address strings', () => {
    const cases = [
      'Case IH plant Grand Island',
      'Northern Plains Equipment 1915 US 2 Minot ND',
      'West Plains I94 Business Loop e Dickinson ND',
      'Case IH plant, Grand Island, NE',
      'West Plains Dickinson I94 Business Loop E',
      '58601',
    ]
    for (const query of cases) {
      expect(isStopReadyForGeocode({ ...createEmptyStop(), query })).toBe(true)
    }
  })

  it('rejects vague short strings without structure', () => {
    expect(isStopReadyForGeocode({ ...createEmptyStop(), query: 'abc' })).toBe(false)
    expect(isStopReadyForGeocode({ ...createEmptyStop(), query: 'hello' })).toBe(false)
  })

  it('accepts city+state structured fallback', () => {
    expect(
      isStopReadyForGeocode({
        ...createEmptyStop(),
        query: '',
        city: 'Minot',
        state: 'ND',
      })
    ).toBe(true)
  })
})

describe('extractAddressFromGeocodeResult', () => {
  it('maps Nominatim address without using county as city', () => {
    const parsed = extractAddressFromGeocodeResult({
      lat: '40.9264',
      lon: '-98.3420',
      address: {
        county: 'Hall County',
        state: 'Nebraska',
        'ISO3166-2-lvl4': 'US-NE',
      },
    })
    expect(parsed?.city).toBe('')
    expect(parsed?.state).toBe('NE')
  })

  it('prefers town over county', () => {
    const parsed = extractAddressFromGeocodeResult({
      lat: '40.9264',
      lon: '-98.3420',
      address: {
        town: 'Grand Island',
        county: 'Hall County',
        'ISO3166-2-lvl4': 'US-NE',
      },
    })
    expect(parsed?.city).toBe('Grand Island')
  })

  it('returns null for invalid lat/lon', () => {
    expect(
      extractAddressFromGeocodeResult({
        lat: 'bad',
        lon: '-98.3420',
        address: { city: 'Grand Island', state: 'Nebraska' },
      })
    ).toBeNull()
  })
})

describe('normalizeDrops', () => {
  it('coerces string lat/lon', () => {
    const result = normalizeDrops([
      { query: 'A', lat: '48.2', lon: '-101.3', city: 'Minot', state: 'ND' },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.drops).toHaveLength(1)
      expect(result.drops[0].lat).toBe(48.2)
      expect(result.drops[0].lon).toBe(-101.3)
    }
  })

  it('returns error when any drop lacks valid coordinates', () => {
    const result = normalizeDrops([
      { query: 'A', lat: '48.2', lon: '-101.3' },
      { query: 'B', lat: 'bad', lon: '-102' },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('drops[1]')
    }
  })

  it('returns error when drop count exceeds MAX_DROPS', () => {
    const tooMany = Array.from({ length: MAX_DROPS + 1 }, (_, i) => ({
      query: `Drop ${i}`,
      lat: 40 + i * 0.1,
      lon: -100 - i * 0.1,
    }))
    const result = normalizeDrops(tooMany)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain(String(MAX_DROPS))
    }
  })

  it('returns empty array for null/undefined', () => {
    expect(normalizeDrops(null)).toEqual({ ok: true, drops: [] })
    expect(normalizeDrops(undefined)).toEqual({ ok: true, drops: [] })
  })
})

describe('syncDestinationFromDrops', () => {
  it('returns unchanged when no drops', () => {
    const data = {
      drops: [] as ReturnType<typeof createEmptyStop>[],
      destination: createEmptyStop(),
      destinationLat: undefined,
      destinationLon: undefined,
    }
    expect(syncDestinationFromDrops(data)).toBe(data)
  })

  it('copies last drop to destination fields', () => {
    const synced = syncDestinationFromDrops({
      drops: [
        { ...createEmptyStop(), query: 'Minot', city: 'Minot', state: 'ND', lat: 48.2, lon: -101.3 },
        { ...createEmptyStop(), query: 'Dickinson', city: 'Dickinson', state: 'ND', lat: 46.9, lon: -102.8 },
      ],
      destination: createEmptyStop(),
      destinationLat: undefined,
      destinationLon: undefined,
    })
    expect(synced.destination.query).toBe('Dickinson')
    expect(synced.destinationLat).toBe(46.9)
  })
})

describe('extractStateCodeFromText', () => {
  it('parses trailing state abbreviations', () => {
    expect(extractStateCodeFromText('Grand Island, NE')).toBe('NE')
  })

  it('parses full state names', () => {
    expect(extractStateCodeFromText('Grand Island, Nebraska')).toBe('NE')
  })
})

describe('extractZipFromText', () => {
  it('extracts 5-digit zip', () => {
    expect(extractZipFromText('near 58601 area')).toBe('58601')
  })

  it('extracts zip+4 prefix', () => {
    expect(extractZipFromText('ship to 68801-1234')).toBe('68801')
  })
})

describe('applyGeocodeToStop', () => {
  it('keeps user query while filling resolved fields', () => {
    const stop = { ...createEmptyStop(), query: 'Case IH plant, Grand Island, NE' }
    const applied = applyGeocodeToStop(stop, {
      street: '',
      city: 'Grand Island',
      state: 'NE',
      zip: '68801',
      lat: 40.9,
      lon: -98.3,
    })
    expect(applied.query).toBe('Case IH plant, Grand Island, NE')
    expect(applied.city).toBe('Grand Island')
  })
})