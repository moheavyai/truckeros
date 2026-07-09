import { describe, expect, it } from 'vitest'
import {
  buildGeocodeSearchVariants,
  expandInterstateNames,
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

  it('deduplicates identical variants', () => {
    const variants = buildGeocodeSearchVariants({ q: 'Minot, ND' })
    const keys = variants.map((v) => v.query)
    expect(new Set(keys).size).toBe(keys.length)
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