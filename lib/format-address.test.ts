import { describe, expect, it } from 'vitest'
import {
  cleanAddressFragment,
  formatPortalAddress,
  formatPortalCityState,
  looksLikeFullAddress,
  resolvePortalAddressParts,
} from './format-address'

describe('cleanAddressFragment', () => {
  it('trims and rejects empty/placeholder values', () => {
    expect(cleanAddressFragment('  Willard  ')).toBe('Willard')
    expect(cleanAddressFragment('')).toBe('')
    expect(cleanAddressFragment(null)).toBe('')
    expect(cleanAddressFragment(undefined)).toBe('')
    expect(cleanAddressFragment('undefined')).toBe('')
    expect(cleanAddressFragment('null')).toBe('')
  })
})

describe('formatPortalCityState', () => {
  it('requires both city and state', () => {
    expect(formatPortalCityState('Houston', 'TX')).toBe('Houston, TX')
    expect(formatPortalCityState(undefined, 'TX')).toBe('')
    expect(formatPortalCityState('Houston', null)).toBe('')
    expect(formatPortalCityState('  ', 'TX')).toBe('')
  })
})

describe('looksLikeFullAddress', () => {
  it('detects street-like queries', () => {
    expect(looksLikeFullAddress('6851 MO 123, Willard, MO 65781')).toBe(true)
    expect(looksLikeFullAddress('805 12th Street West, Lamar, MO 64759')).toBe(true)
    expect(looksLikeFullAddress('123 Main St')).toBe(true)
    expect(looksLikeFullAddress('Willard, MO')).toBe(false)
    expect(looksLikeFullAddress('Case IH plant Grand Island')).toBe(false)
  })

  it('covers boundary cases', () => {
    expect(looksLikeFullAddress('')).toBe(false)
    expect(looksLikeFullAddress('   ')).toBe(false)
    // multi-comma without house number still treated as full address
    expect(looksLikeFullAddress('Plant A, Dock 2, Building C')).toBe(true)
    // two-part street + city with leading house number
    expect(looksLikeFullAddress('123 Main St, Springfield')).toBe(true)
    // highway token with a number
    expect(looksLikeFullAddress('mile marker 12 on Highway 65')).toBe(true)
    // plain city/state remains false
    expect(looksLikeFullAddress('Springfield, IL')).toBe(false)
  })
})

describe('formatPortalAddress', () => {
  it('builds full string from street + city + state + zip', () => {
    expect(
      formatPortalAddress({
        street: '6851 MO 123',
        city: 'Willard',
        state: 'MO',
        zip: '65781',
      })
    ).toBe('6851 MO 123, Willard, MO 65781')

    expect(
      formatPortalAddress({
        street: '805 12th Street West',
        city: 'Lamar',
        state: 'MO',
        zip: '64759',
      })
    ).toBe('805 12th Street West, Lamar, MO 64759')
  })

  it('formats city/state only as "City, ST"', () => {
    expect(
      formatPortalAddress({
        city: 'Willard',
        state: 'MO',
      })
    ).toBe('Willard, MO')

    expect(
      formatPortalAddress({
        city: 'Houston',
        state: 'TX',
        street: '',
        zip: '',
      })
    ).toBe('Houston, TX')
  })

  it('uses query when it looks like a full address and street is missing', () => {
    expect(
      formatPortalAddress({
        query: '6851 MO 123, Willard, MO 65781',
        city: 'Willard',
        state: 'MO',
      })
    ).toBe('6851 MO 123, Willard, MO 65781')

    expect(
      formatPortalAddress({
        query: '805 12th Street West, Lamar, MO 64759',
      })
    ).toBe('805 12th Street West, Lamar, MO 64759')
  })

  it('prefers structured street over query', () => {
    expect(
      formatPortalAddress({
        street: '100 Main St',
        city: 'Springfield',
        state: 'MO',
        zip: '65801',
        query: 'some other text',
      })
    ).toBe('100 Main St, Springfield, MO 65801')
  })

  it('does not invent street when only city/state exist', () => {
    expect(
      formatPortalAddress({
        city: 'Tulsa',
        state: 'OK',
        query: 'Tulsa, OK',
      })
    ).toBe('Tulsa, OK')
  })

  it('avoids duplicating locality when street already includes city/state/zip', () => {
    expect(
      formatPortalAddress({
        street: '6851 MO 123, Willard, MO 65781',
        city: 'Willard',
        state: 'MO',
        zip: '65781',
      })
    ).toBe('6851 MO 123, Willard, MO 65781')
  })

  it('appends only zip when street already has city+state but not zip', () => {
    expect(
      formatPortalAddress({
        street: '6851 MO 123, Willard, MO',
        city: 'Willard',
        state: 'MO',
        zip: '65781',
      })
    ).toBe('6851 MO 123, Willard, MO 65781')
  })

  it('does not treat state codes embedded in city/street words as locality complete', () => {
    // "in" inside Springfield must not drop state IN
    expect(
      formatPortalAddress({
        street: '100 Main St, Springfield',
        city: 'Springfield',
        state: 'IN',
        zip: '46201',
      })
    ).toBe('100 Main St, Springfield, IN 46201')

    // "or" inside North must not drop state OR (city token already on street → append ST ZIP only)
    expect(
      formatPortalAddress({
        street: '1 North Ave',
        city: 'North',
        state: 'OR',
        zip: '97001',
      })
    ).toBe('1 North Ave, OR 97001')

    // "ok" inside Brook must not drop state OK
    expect(
      formatPortalAddress({
        street: '5 Brook Rd',
        city: 'Brook',
        state: 'OK',
        zip: '73001',
      })
    ).toBe('5 Brook Rd, OK 73001')
  })

  it('does not treat highway state labels mid-street as completed locality', () => {
    // "MO" in "6851 MO 123" is a route label, not ", MO" locality
    expect(
      formatPortalAddress({
        street: '6851 MO 123',
        city: 'Willard',
        state: 'MO',
        zip: '65781',
      })
    ).toBe('6851 MO 123, Willard, MO 65781')
  })

  it('appends state when street has city but not state', () => {
    expect(
      formatPortalAddress({
        street: '100 Main St, Springfield',
        city: 'Springfield',
        state: 'MO',
      })
    ).toBe('100 Main St, Springfield, MO')
  })

  it('formats partial structured branches', () => {
    expect(
      formatPortalAddress({
        street: '100 Main St',
        city: 'Springfield',
      })
    ).toBe('100 Main St, Springfield')

    expect(
      formatPortalAddress({
        street: '100 Main St',
      })
    ).toBe('100 Main St')

    expect(
      formatPortalAddress({
        street: '100 Main St',
        city: 'Springfield',
        state: 'MO',
      })
    ).toBe('100 Main St, Springfield, MO')
  })

  it('uses non-street-like query as last resort (business name)', () => {
    expect(
      formatPortalAddress({
        query: 'Case IH plant Grand Island',
      })
    ).toBe('Case IH plant Grand Island')
  })

  it('returns empty when nothing usable', () => {
    expect(formatPortalAddress({})).toBe('')
    expect(formatPortalAddress({ city: undefined, state: 'TX' })).toBe('')
    expect(formatPortalAddress({ city: 'Houston', state: undefined })).toBe('')
  })

  it('includes zip after city/state when street missing', () => {
    expect(
      formatPortalAddress({
        city: 'Willard',
        state: 'MO',
        zip: '65781',
      })
    ).toBe('Willard, MO 65781')
  })
})

describe('resolvePortalAddressParts', () => {
  it('reads flat permit_requests columns', () => {
    expect(
      resolvePortalAddressParts(
        {
          origin_city: 'Willard',
          origin_state: 'MO',
          origin_query: '6851 MO 123, Willard, MO 65781',
          origin_street: '6851 MO 123',
          origin_zip: '65781',
        },
        'origin'
      )
    ).toEqual({
      street: '6851 MO 123',
      city: 'Willard',
      state: 'MO',
      zip: '65781',
      query: '6851 MO 123, Willard, MO 65781',
    })
  })

  it('reads nested loadDetails origin/destination', () => {
    expect(
      resolvePortalAddressParts(
        {
          origin: {
            query: '6851 MO 123, Willard, MO 65781',
            street: '6851 MO 123',
            city: 'Willard',
            state: 'MO',
            zip: '65781',
          },
          destination: {
            street: '805 12th Street West',
            city: 'Lamar',
            state: 'MO',
            zip: '64759',
          },
        },
        'destination'
      )
    ).toEqual({
      street: '805 12th Street West',
      city: 'Lamar',
      state: 'MO',
      zip: '64759',
      query: null,
    })
  })

  it('prefers nested fields over flat when both exist', () => {
    const parts = resolvePortalAddressParts(
      {
        origin_city: 'FlatCity',
        origin_state: 'TX',
        origin: { city: 'NestedCity', state: 'MO', street: '1 Nested St' },
      },
      'origin'
    )
    expect(parts.city).toBe('NestedCity')
    expect(parts.street).toBe('1 Nested St')
  })

  it('guards null/undefined/non-object and nested non-object', () => {
    expect(resolvePortalAddressParts(null, 'origin')).toEqual({})
    expect(resolvePortalAddressParts(undefined, 'destination')).toEqual({})
    // arrays are objects in JS but we still accept them as request bags
    expect(resolvePortalAddressParts(['x'] as any, 'origin')).toEqual({
      street: null,
      city: null,
      state: null,
      zip: null,
      query: null,
    })
    // nested origin is a string → ignore nested, use flat
    expect(
      resolvePortalAddressParts(
        { origin: 'not-an-object', origin_city: 'Willard', origin_state: 'MO' },
        'origin'
      )
    ).toEqual({
      street: null,
      city: 'Willard',
      state: 'MO',
      zip: null,
      query: null,
    })
  })

  it('reads street/zip aliases (address, origin_address, postal_code)', () => {
    expect(
      resolvePortalAddressParts(
        {
          origin_address: '10 Alias St',
          origin_city: 'Town',
          origin_state: 'KS',
          origin_postal_code: '66002',
        },
        'origin'
      )
    ).toEqual({
      street: '10 Alias St',
      city: 'Town',
      state: 'KS',
      zip: '66002',
      query: null,
    })

    expect(
      resolvePortalAddressParts(
        {
          destination: {
            address: '20 Nested Alias',
            city: 'Lamar',
            state: 'MO',
            postal_code: '64759',
          },
        },
        'destination'
      )
    ).toEqual({
      street: '20 Nested Alias',
      city: 'Lamar',
      state: 'MO',
      zip: '64759',
      query: null,
    })
  })
})
