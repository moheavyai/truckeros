import { describe, expect, it } from 'vitest'
import { buildGeocodeSearchVariants, parseNaturalLanguageQuery } from './geocode-query'
import { rankResults, stripNominatimResults } from './geocode-server'
import { STATE_CODE_TO_NAME } from './us-states'

const LIVE = process.env.LIVE_GEOCODE === '1'
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function buildUrl(
  strategy: 'freetext' | 'structured',
  opts: { query: string; city: string; street: string; stateParam: string | null; limit: string },
) {
  const base = new URLSearchParams({
    format: 'json',
    limit: opts.limit,
    countrycodes: 'us',
    addressdetails: '1',
    email: 'support@truckeros.app',
  })

  if (strategy === 'structured' && opts.city && opts.stateParam) {
    base.set('city', opts.city.trim())
    base.set('state', STATE_CODE_TO_NAME[opts.stateParam])
    base.set('country', 'United States')
    if (opts.street.trim()) base.set('street', opts.street.trim())
  } else {
    base.set('q', opts.query)
    if (opts.stateParam) base.set('state', STATE_CODE_TO_NAME[opts.stateParam])
  }

  return `${NOMINATIM_BASE}/search?${base.toString()}`
}

async function geocodeWithVariants(q: string) {
  const parsed = parseNaturalLanguageQuery(q)
  const variants = buildGeocodeSearchVariants({ q, state: parsed.state })

  for (const variant of variants) {
    for (const strategy of variant.strategies) {
      const url = buildUrl(strategy, {
        query: variant.query,
        city: variant.city,
        street: variant.street,
        stateParam: variant.state,
        limit: '3',
      })

      const res = await fetch(url, {
        headers: { 'User-Agent': 'TruckerOS Permit Agent (support@truckeros.app)' },
      })
      if (!res.ok) {
        await sleep(1100)
        continue
      }

      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        const dtos = stripNominatimResults(data).map((dto, i) => ({
          ...dto,
          importance: data[i]?.importance as number | undefined,
        }))
        const ranked = rankResults(dtos, parsed.state, parsed)
        const best = ranked[0]
        const addr = best.address || {}
        return {
          lat: Number(best.lat),
          lon: Number(best.lon),
          city: addr.city || addr.town || '',
          state: addr.state_code || parsed.state || '',
          road: addr.road || '',
          variant: variant.id,
          variantQuery: variant.query,
        }
      }
      await sleep(1100)
    }
  }

  return null
}

describe.skipIf(!LIVE)('live geocode integration', () => {
  it('resolves Case IH plant pickup in Grand Island, NE', async () => {
    const result = await geocodeWithVariants('Case IH plant Grand Island')
    expect(result).not.toBeNull()
    expect(result!.state).toBe('NE')
    expect(result!.city.toLowerCase()).toContain('grand island')
    expect(result!.lat).toBeGreaterThan(40)
    expect(result!.lat).toBeLessThan(41)
  }, 120_000)

  it('resolves Northern Plains Equipment / US-2 in Minot, ND', async () => {
    const result = await geocodeWithVariants('Northern Plains Equipment 1915 US 2 Minot ND')
    expect(result).not.toBeNull()
    expect(result!.state).toBe('ND')
    expect(result!.city.toLowerCase()).toBe('minot')
    expect(result!.lat).toBeGreaterThan(48)
    expect(result!.lat).toBeLessThan(49)
  }, 120_000)

  it('resolves West Plains on I-94 Business Loop in Dickinson, ND', async () => {
    const result = await geocodeWithVariants(
      'West Plains I94 Business Loop e Dickinson ND',
    )
    expect(result).not.toBeNull()
    expect(result!.state).toBe('ND')
    expect(result!.city.toLowerCase()).toBe('dickinson')
    expect(result!.road.toLowerCase()).toMatch(/interstate 94|i-94|business loop/)
    expect(result!.lat).toBeGreaterThan(46.8)
    expect(result!.lat).toBeLessThan(47)
  }, 120_000)
})