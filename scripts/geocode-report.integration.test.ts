import { describe, it } from 'vitest'
import { buildGeocodeSearchVariants, parseNaturalLanguageQuery } from '../lib/geocode-query'
import { rankResults, stripNominatimResults } from '../lib/geocode-server'
import { STATE_CODE_TO_NAME } from '../lib/us-states'

const LIVE = process.env.LIVE_GEOCODE === '1'
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'

const TEST_QUERIES: Array<[string, string]> = [
  ['Pickup', 'Case IH plant Grand Island'],
  ['Drop 1', 'Northern Plains Equipment 1915 US 2 Minot ND'],
  ['Drop 2', 'West Plains I94 Business Loop e Dickinson ND'],
]

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

describe.skipIf(!LIVE)('geocode report', () => {
  it('prints live geocode results for summary', async () => {
    console.log('\n=== Geocode Test Results ===')
    for (const [label, q] of TEST_QUERIES) {
      const result = await geocodeWithVariants(q)
      console.log(`\n${label}: "${q}"`)
      if (!result) {
        console.log('  FAILED: no results')
        continue
      }
      console.log(`  lat: ${result.lat}`)
      console.log(`  lon: ${result.lon}`)
      console.log(`  city: ${result.city}`)
      console.log(`  state: ${result.state}`)
      console.log(`  road: ${result.road}`)
      console.log(`  winning variant: ${result.variant} (${result.variantQuery})`)
    }
  }, 300_000)
})