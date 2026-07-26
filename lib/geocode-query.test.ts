import { describe, expect, it } from 'vitest'
import {
  buildGeocodeSearchVariants,
  expandInterstateNames,
  extractStateHighwayRoute,
  insertCommasInUnstructuredQuery,
  normalizeGeocodeQuery,
  normalizeHighwayTokens,
  parseNaturalLanguageQuery,
  roadNamesMatch,
} from './geocode-query'

describe('normalizeHighwayTokens', () => {
  it('expands I94 Business Loop E', () => {
    expect(normalizeHighwayTokens('3484 I94 Business Loop E')).toBe(
      '3484 I-94 Business Loop East'
    )
  })

  it('expands US-2', () => {
    expect(normalizeHighwayTokens('1915 US-2')).toBe('1915 US Highway 2')
  })
})

describe('normalizeGeocodeQuery', () => {
  it('inserts commas in unstructured West Plains partial', () => {
    const normalized = normalizeGeocodeQuery('West Plains Dickinson I94 Business Loop E')
    expect(normalized).toContain('West Plains')
    expect(normalized).toContain('Dickinson')
    expect(normalized).toMatch(/I-94 Business Loop East/i)
  })

  it('inserts commas for mobile pickup shorthand', () => {
    const normalized = normalizeGeocodeQuery('Case IH plant Grand Island')
    expect(normalized).toContain('Case IH plant')
    expect(normalized).toContain('Grand Island')
    expect(normalized).toMatch(/,\s*NE$/)
  })

  it('inserts commas for drop without commas', () => {
    const normalized = normalizeGeocodeQuery('Northern Plains Equipment 1915 US 2 Minot ND')
    expect(normalized).toContain('Northern Plains Equipment')
    expect(normalized).toContain('Minot')
    expect(normalized).toContain('ND')
    expect(normalized).toMatch(/1915 US Highway 2/i)
  })

  it('preserves comma-separated addresses', () => {
    expect(normalizeGeocodeQuery('Case IH plant, Grand Island, NE')).toContain('Grand Island')
  })
})

describe('parseNaturalLanguageQuery', () => {
  it('parses mobile pickup without commas or state', () => {
    const parsed = parseNaturalLanguageQuery('Case IH plant Grand Island')
    expect(parsed.businessName).toBe('Case IH plant')
    expect(parsed.city).toBe('Grand Island')
    expect(parsed.state).toBe('NE')
    expect(parsed.street).toBe('')
  })

  it('parses business + street + city + state without commas', () => {
    const parsed = parseNaturalLanguageQuery(
      'Northern Plains Equipment 1915 US 2 Minot ND'
    )
    expect(parsed.businessName).toBe('Northern Plains Equipment')
    expect(parsed.street).toMatch(/1915 US Highway 2/i)
    expect(parsed.city).toBe('Minot')
    expect(parsed.state).toBe('ND')
  })

  it('parses West Plains drop with grammar variations', () => {
    const parsed = parseNaturalLanguageQuery(
      'West Plains I94 Business Loop e Dickinson ND'
    )
    expect(parsed.businessName).toBe('West Plains')
    expect(parsed.city).toBe('Dickinson')
    expect(parsed.state).toBe('ND')
    expect(parsed.street).toMatch(/I-94 Business Loop East/i)
  })

  it('parses comma-separated business + street + city + state', () => {
    const parsed = parseNaturalLanguageQuery(
      'Northern Plains Equipment, 1915 US-2, Minot, ND'
    )
    expect(parsed.businessName).toBe('Northern Plains Equipment')
    expect(parsed.street).toMatch(/1915 US Highway 2/i)
    expect(parsed.city).toBe('Minot')
    expect(parsed.state).toBe('ND')
  })

  it('parses West Plains full drop address with house number', () => {
    const parsed = parseNaturalLanguageQuery(
      'West Plains, 3484 I94 Business Loop E, Dickinson, ND'
    )
    expect(parsed.businessName).toBe('West Plains')
    expect(parsed.city).toBe('Dickinson')
    expect(parsed.state).toBe('ND')
    expect(parsed.street).toMatch(/3484 I-94 Business Loop East/i)
  })

  it('parses partial drop without commas', () => {
    const parsed = parseNaturalLanguageQuery('West Plains Dickinson I94 Business Loop E')
    expect(parsed.businessName).toBe('West Plains')
    expect(parsed.city).toBe('Dickinson')
    expect(parsed.street).toMatch(/I-94 Business Loop East/i)
    expect(parsed.state).toBe('ND')
  })
})

describe('buildGeocodeSearchVariants', () => {
  it('includes interstate expanded fallback for Drop 2', () => {
    const variants = buildGeocodeSearchVariants({
      q: 'West Plains, 3484 I94 Business Loop E, Dickinson, ND',
    })
    const queries = variants.map((v) => v.query)
    expect(queries.some((q) => /Interstate 94 Business Loop East/i.test(q))).toBe(true)
    expect(queries.some((q) => /Dickinson/i.test(q) && /ND/i.test(q))).toBe(true)
  })

  it('includes street-only fallback for Northern Plains', () => {
    const variants = buildGeocodeSearchVariants({
      q: 'Northern Plains Equipment, 1915 US-2, Minot, ND',
    })
    const queries = variants.map((v) => v.query)
    expect(queries.some((q) => /1915 US Highway 2/i.test(q) && /Minot/i.test(q))).toBe(true)
  })

  it('adds MO-123 / MO 123 variants for State Hwy (strips compass)', () => {
    const variants = buildGeocodeSearchVariants({
      q: '6851 N State Hwy 123, Willard, MO',
      street: '6851 N State Hwy 123',
      city: 'Willard',
      state: 'MO',
    })
    const queries = variants.map((v) => v.query)
    // Original raw form retained
    expect(queries.some((q) => /6851 N State Hwy 123/i.test(q))).toBe(true)
    // Both Nominatim-friendly state-route forms with house number
    expect(queries.some((q) => /\b6851\s+MO-123\b/i.test(q))).toBe(true)
    expect(queries.some((q) => /\b6851\s+MO\s+123\b/i.test(q))).toBe(true)
    // Compass must not sit immediately before the state route
    expect(queries.some((q) => /\b6851\s+N\s+MO-123\b/i.test(q))).toBe(false)
    expect(queries.some((q) => /\b6851\s+N\s+MO\s+123\b/i.test(q))).toBe(false)
  })

  it('adds state-route variants for SH / SR forms', () => {
    const sh = buildGeocodeSearchVariants({
      street: '100 SH 45',
      city: 'Springfield',
      state: 'MO',
    })
    const shQueries = sh.map((v) => v.query)
    expect(shQueries.some((q) => /\b100\s+MO-45\b/i.test(q))).toBe(true)
    expect(shQueries.some((q) => /\b100\s+MO\s+45\b/i.test(q))).toBe(true)

    const sr = buildGeocodeSearchVariants({
      street: '200 SR 12',
      city: 'Columbia',
      state: 'MO',
    })
    const srQueries = sr.map((v) => v.query)
    expect(srQueries.some((q) => /\b200\s+MO-12\b/i.test(q))).toBe(true)
  })

  it('free-text multi-digit SH without house yields MO-45 variants', () => {
    const variants = buildGeocodeSearchVariants({
      q: 'SH 45, Springfield, MO',
    })
    const queries = variants.map((v) => v.query)
    // looksLikeStreet must recognize multi-digit SH so street is parsed
    expect(variants.some((v) => /SH\s+45/i.test(v.street) || /SH\s+45/i.test(v.context.street))).toBe(
      true
    )
    expect(queries.some((q) => /\bMO-45\b/i.test(q))).toBe(true)
    expect(queries.some((q) => /\bMO\s+45\b/i.test(q))).toBe(true)
  })

  it('adds state-route variants for bare Hwy when state is known', () => {
    const variants = buildGeocodeSearchVariants({
      street: '6851 Hwy 123',
      city: 'Willard',
      state: 'MO',
    })
    const queries = variants.map((v) => v.query)
    expect(queries.some((q) => /\b6851\s+MO-123\b/i.test(q))).toBe(true)
    expect(queries.some((q) => /\b6851\s+MO\s+123\b/i.test(q))).toBe(true)
  })

  it('adds state-route variants without house number', () => {
    const variants = buildGeocodeSearchVariants({
      street: 'State Hwy 123',
      city: 'Willard',
      state: 'MO',
    })
    const queries = variants.map((v) => v.query)
    expect(queries.some((q) => /\bMO-123\b/i.test(q))).toBe(true)
    expect(queries.some((q) => /\bMO\s+123\b/i.test(q))).toBe(true)
  })

  it('does not invent state-route codes when state is omitted', () => {
    const variants = buildGeocodeSearchVariants({
      street: '6851 N State Hwy 123',
      city: 'Willard',
    })
    const queries = variants.map((v) => v.query)
    expect(queries.some((q) => /\bMO-123\b/i.test(q) || /\bMO\s+123\b/i.test(q))).toBe(false)
  })

  it('does not invent state routes from unnormalized US Hwy', () => {
    const variants = buildGeocodeSearchVariants({
      street: '1915 US Hwy 2',
      city: 'Minot',
      state: 'ND',
    })
    const queries = variants.map((v) => v.query)
    expect(queries.some((q) => /\bND-2\b/i.test(q) || /\bND\s+2\b/.test(q))).toBe(false)
  })

  it('does not invent state routes from County Hwy', () => {
    const variants = buildGeocodeSearchVariants({
      street: '500 County Hwy 12',
      city: 'Willard',
      state: 'MO',
    })
    const queries = variants.map((v) => v.query)
    expect(queries.some((q) => /\bMO-12\b/i.test(q) || /\bMO\s+12\b/.test(q))).toBe(false)
  })

  it('still produces I-/Interstate variants for interstate-only addresses', () => {
    const variants = buildGeocodeSearchVariants({
      q: '3484 I-94 Business Loop East, Dickinson, ND',
      street: '3484 I-94 Business Loop East',
      city: 'Dickinson',
      state: 'ND',
    })
    const queries = variants.map((v) => v.query)
    expect(queries.some((q) => /\bI-94\b/i.test(q))).toBe(true)
    expect(queries.some((q) => /Interstate 94/i.test(q))).toBe(true)
    // Must not invent ND-94 from interstate
    expect(queries.some((q) => /\bND-94\b/i.test(q) || /\bND\s+94\b/.test(q))).toBe(false)
  })

  it('deduplicates identical variants', () => {
    const variants = buildGeocodeSearchVariants({ q: 'Minot, ND' })
    const keys = variants.map((v) => v.query)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('extractStateHighwayRoute', () => {
  it('detects State Hwy / State Highway / State Route', () => {
    expect(extractStateHighwayRoute('6851 N State Hwy 123')).toBe('123')
    expect(extractStateHighwayRoute('State Highway 45')).toBe('45')
    expect(extractStateHighwayRoute('State Route 7')).toBe('7')
    expect(extractStateHighwayRoute('State Road 9')).toBe('9')
  })

  it('detects SH and SR', () => {
    expect(extractStateHighwayRoute('100 SH 45')).toBe('45')
    expect(extractStateHighwayRoute('200 SR 12')).toBe('12')
  })

  it('detects bare Hwy when not US/County', () => {
    expect(extractStateHighwayRoute('6851 Hwy 123')).toBe('123')
  })

  it('rejects US Hwy raw forms and County Hwy', () => {
    expect(extractStateHighwayRoute('1915 US Hwy 2')).toBeNull()
    expect(extractStateHighwayRoute('1915 U.S. Highway 2')).toBeNull()
    expect(extractStateHighwayRoute('1915 US-2')).toBeNull()
    expect(extractStateHighwayRoute('1915 US Highway 2')).toBeNull()
    expect(extractStateHighwayRoute('500 County Hwy 12')).toBeNull()
    expect(extractStateHighwayRoute('500 Co Hwy 12')).toBeNull()
    expect(extractStateHighwayRoute('3484 I-94')).toBeNull()
  })
})

describe('roadNamesMatch', () => {
  it('matches interstate business loop variants', () => {
    expect(
      roadNamesMatch(
        'I-94 Business Loop East',
        'Interstate 94 Business Loop East'
      )
    ).toBe(true)
  })
})

describe('expandInterstateNames', () => {
  it('expands I-94 to Interstate 94', () => {
    expect(expandInterstateNames('3484 I-94 Business Loop East')).toBe(
      '3484 Interstate 94 Business Loop East'
    )
  })
})

describe('insertCommasInUnstructuredQuery', () => {
  it('splits business city and street', () => {
    const normalized = insertCommasInUnstructuredQuery('West Plains Dickinson I-94 Business Loop East')
    expect(normalized).toContain('West Plains')
    expect(normalized).toContain('Dickinson')
    expect(normalized).toMatch(/I-94 Business Loop East/)
    expect(normalized).toMatch(/,\s*ND$/)
  })
})