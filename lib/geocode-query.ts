/**
 * Query normalization, natural-language parsing, and fallback search variants
 * for Nominatim geocoding (business names, highways, partial addresses).
 */

import { STATE_CODE_TO_NAME, US_STATE_CODES, US_STATE_NAME_TO_CODE } from '@/lib/us-states'

export type ParsedGeocodeQuery = {
  raw: string
  normalized: string
  businessName: string
  street: string
  city: string
  state: string | null
  zip: string | null
}

export type GeocodeSearchVariant = {
  id: string
  query: string
  city: string
  street: string
  state: string | null
  zip: string
  strategies: Array<'freetext' | 'structured'>
  context: ParsedGeocodeQuery
}

const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/

const INTERSTATE_RE =
  /\b(?:I[-\s]?|Interstate\s+)(\d{1,3})(?:\s+(?:Business\s+)?(?:Loop|BL|B\.?L\.?)\s*(E(?:ast)?|W(?:est)?)?)?/gi

const US_HIGHWAY_RE = /\b(?:US[-\s]?|U\.?S\.?\s*(?:H(?:wy|ighway)?\.?)?\s*)(\d{1,3})\b/gi

/** Common corridor cities when state is omitted (mobile shorthand). Longest names first. */
const KNOWN_CITY_STATE: Record<string, string> = {
  'grand island': 'NE',
  minot: 'ND',
  dickinson: 'ND',
  bismarck: 'ND',
  fargo: 'ND',
  williston: 'ND',
  'north platte': 'NE',
  kearney: 'NE',
  lincoln: 'NE',
  omaha: 'NE',
}

const STREET_SEGMENT_PATTERNS = [
  /\d{1,6}\s+(?:I-\d{1,3}|Interstate \d{1,3}|US Highway \d{1,3})(?:\s+Business\s+Loop\s+(?:East|West))?/i,
  /(?:I-\d{1,3}|Interstate \d{1,3}|US Highway \d{1,3})(?:\s+Business\s+Loop\s+(?:East|West))?/i,
  /\d{1,6}\s+(?:[A-Za-z0-9][\w.-]*\s+){0,5}(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Dr|Drive|Blvd|Boulevard|Way|Ln|Lane|Hwy|Highway)\b[\w\s.-]*/i,
  /\d{1,6}\s+\S+(?:\s+\S+){0,3}/i,
]

const HOUSE_STREET_RE =
  /^(\d{1,6})\s+(.+)$/i

/** Normalize highway tokens for better Nominatim matching. */
export function normalizeHighwayTokens(text: string): string {
  let out = text

  out = out.replace(/\bBusiness\s+Loop\s+E\b/gi, 'Business Loop East')
  out = out.replace(/\bBusiness\s+Loop\s+W\b/gi, 'Business Loop West')
  out = out.replace(/\bBus(?:iness)?\s*\.?\s*Loop\s+E\b/gi, 'Business Loop East')
  out = out.replace(/\bBus(?:iness)?\s*\.?\s*Loop\s+W\b/gi, 'Business Loop West')
  out = out.replace(/\bBL\s+E\b/gi, 'Business Loop East')
  out = out.replace(/\bBL\s+W\b/gi, 'Business Loop West')
  out = out.replace(/\bBusiness\s+Loop\s+e\b/gi, 'Business Loop East')
  out = out.replace(/\bBusiness\s+Loop\s+w\b/gi, 'Business Loop West')
  out = out.replace(/\bLoop\s+e\b/gi, 'Loop East')
  out = out.replace(/\bLoop\s+w\b/gi, 'Loop West')

  out = out.replace(INTERSTATE_RE, (_match, num: string, dir?: string) => {
    const direction = dir ? ` Business Loop ${dir.startsWith('W') ? 'West' : 'East'}` : ''
    return `I-${num}${direction}`
  })

  // Second pass: bare I94 without "Interstate" prefix
  out = out.replace(/\bI(\d{1,3})\b/gi, (_m, num: string) => `I-${num}`)

  out = out.replace(US_HIGHWAY_RE, (_match, num: string) => `US Highway ${num}`)

  return out.replace(/\s+/g, ' ').trim()
}

/** Expand I-94 style to Interstate 94 for Nominatim freetext that prefers full names. */
export function expandInterstateNames(text: string): string {
  return text.replace(/\bI-(\d{1,3})(\s+Business\s+Loop\s+(?:East|West))?/gi, (_m, num: string, loop?: string) => {
    return `Interstate ${num}${loop || ''}`
  })
}

/** Normalize a free-text geocode query. */
export function normalizeGeocodeQuery(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''

  const withHighways = normalizeHighwayTokens(trimmed)

  if (withHighways.includes(',')) {
    return withHighways
  }

  return insertCommasInUnstructuredQuery(withHighways)
}

type UnstructuredAddressParts = {
  businessName: string
  street: string
  city: string
  state: string | null
}

function titleCaseCity(cityKey: string): string {
  return cityKey
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Peel trailing 2-letter state from unstructured text. */
function peelTrailingState(text: string): { remainder: string; state: string | null } {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { remainder: '', state: null }

  const last = tokens[tokens.length - 1]
  const state = normalizeStateToken(last)
  if (state) {
    return { remainder: tokens.slice(0, -1).join(' '), state }
  }
  return { remainder: text.trim(), state: null }
}

/** Match a known multi-word or single-word city at the end of text. */
function peelKnownCity(text: string): { remainder: string; city: string; state: string | null } | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const keys = Object.keys(KNOWN_CITY_STATE).sort((a, b) => b.length - a.length)
  for (const cityKey of keys) {
    const re = new RegExp(`\\b${cityKey.replace(/\s+/g, '\\s+')}\\s*$`, 'i')
    const match = trimmed.match(re)
    if (!match) continue
    const remainder = trimmed.slice(0, trimmed.length - match[0].length).trim()
    return {
      remainder,
      city: titleCaseCity(cityKey),
      state: KNOWN_CITY_STATE[cityKey],
    }
  }
  return null
}

/** If a generic street regex swallowed a trailing city token, move it to `after`. */
function detachTrailingCityFromStreet(
  street: string,
  after: string,
): { street: string; after: string } {
  const known = peelKnownCity(street)
  if (!known) return { street, after }
  return {
    street: known.remainder.trim(),
    after: [known.city, after].filter(Boolean).join(' ').trim(),
  }
}

/** Find a street/highway segment embedded in unstructured text (not greedy to EOL). */
function findStreetSegment(text: string): { street: string; before: string; after: string } | null {
  const normalized = normalizeHighwayTokens(text)

  // Prefer specific highway/house patterns before the generic numbered-street fallback.
  for (const pattern of STREET_SEGMENT_PATTERNS) {
    const match = normalized.match(pattern)
    if (!match || match.index == null) continue

    let street = match[0].trim()
    if (street.length < 3) continue

    const before = normalized.slice(0, match.index).trim()
    let after = normalized.slice(match.index + street.length).trim()
    ;({ street, after } = detachTrailingCityFromStreet(street, after))

    if (!street) continue
    return { street, before, after }
  }

  return null
}

/** Split unstructured mobile-friendly address text into business / street / city / state. */
export function splitUnstructuredAddress(text: string): UnstructuredAddressParts {
  const normalized = normalizeHighwayTokens(text.trim())
  const { remainder: withoutState, state: peeledState } = peelTrailingState(normalized)

  const streetHit = findStreetSegment(withoutState)
  if (streetHit) {
    const afterCity = peelKnownCity(streetHit.after)
    if (afterCity) {
      return {
        businessName: [streetHit.before, afterCity.remainder].filter(Boolean).join(' ').trim(),
        street: streetHit.street,
        city: afterCity.city,
        state: peeledState || afterCity.state,
      }
    }

    const afterTokens = streetHit.after.split(/\s+/).filter(Boolean)
    const city = afterTokens.length > 0 ? afterTokens[afterTokens.length - 1] : ''
    const businessTail = afterTokens.slice(0, -1).join(' ')
    const businessName = [streetHit.before, businessTail].filter(Boolean).join(' ').trim()

    let cityName = city
    let state = peeledState
    if (!cityName) {
      const known = peelKnownCity(streetHit.before)
      if (known) {
        cityName = known.city
        state = state || known.state
        return {
          businessName: known.remainder,
          street: streetHit.street,
          city: cityName,
          state,
        }
      }
    }

    return {
      businessName,
      street: streetHit.street,
      city: titleCaseCity(cityName),
      state: state || (cityName ? inferStateFromCity(cityName) : null),
    }
  }

  const known = peelKnownCity(withoutState)
  if (known) {
    return {
      businessName: known.remainder,
      street: '',
      city: known.city,
      state: peeledState || known.state,
    }
  }

  const tokens = withoutState.split(/\s+/).filter(Boolean)
  if (tokens.length >= 2) {
    const city = tokens[tokens.length - 1]
    return {
      businessName: tokens.slice(0, -1).join(' '),
      street: '',
      city: titleCaseCity(city),
      state: peeledState || inferStateFromCity(city),
    }
  }

  return {
    businessName: withoutState,
    street: '',
    city: '',
    state: peeledState,
  }
}

/** Insert commas between business / city / street segments when user omits them. */
export function insertCommasInUnstructuredQuery(text: string): string {
  const parts = splitUnstructuredAddress(text)
  const segments: string[] = []
  if (parts.businessName) segments.push(parts.businessName)
  if (parts.city) segments.push(parts.city)
  if (parts.street) segments.push(parts.street)
  if (parts.state) segments.push(parts.state)
  return segments.length > 0 ? segments.join(', ') : text.trim()
}

/** Pull highway / numbered-street segment from unstructured text. */
export function extractStreetPortion(text: string): string {
  return findStreetSegment(text)?.street || ''
}

function normalizeStateToken(token: string): string | null {
  const upper = token.trim().toUpperCase()
  if (upper.length === 2 && US_STATE_CODES.has(upper)) return upper
  const nameKey = token.trim().toLowerCase()
  return US_STATE_NAME_TO_CODE[nameKey] || null
}

function cityFromAddressFields(addr: Record<string, string | undefined>): string {
  return (
    addr.city ||
    addr.town ||
    addr.village ||
    addr.hamlet ||
    addr.municipality ||
    ''
  )
}

/** Parse natural-language or structured geocode input. */
export function parseNaturalLanguageQuery(raw: string): ParsedGeocodeQuery {
  const trimmed = raw.trim()
  const normalized = normalizeGeocodeQuery(trimmed)
  const zipMatch = trimmed.match(ZIP_RE)
  const zip = zipMatch ? zipMatch[1] : null

  let businessName = ''
  let street = ''
  let city = ''
  let state: string | null = null

  if (normalized.includes(',')) {
    const parts = normalized.split(',').map((p) => p.trim()).filter(Boolean)
    const last = parts[parts.length - 1]
    const maybeState = normalizeStateToken(last)
    if (maybeState) {
      state = maybeState
      parts.pop()
    } else if (last && /^\d{5}/.test(last)) {
      parts.pop()
    }

    if (parts.length >= 2) {
      const streetIdx = parts.findIndex((p) => looksLikeStreet(p))
      if (streetIdx >= 0) {
        street = parts[streetIdx]
        const remaining = parts.filter((_, i) => i !== streetIdx)
        if (remaining.length >= 2) {
          businessName = remaining[0]
          city = remaining[remaining.length - 1]
        } else if (remaining.length === 1) {
          if (streetIdx === 0) city = remaining[0]
          else businessName = remaining[0]
        }
      } else if (parts.length >= 3) {
        businessName = parts[0]
        city = parts[parts.length - 1]
      } else {
        businessName = parts[0]
        city = parts[1]
      }
    } else if (parts.length === 1) {
      if (looksLikeStreet(parts[0])) street = parts[0]
      else city = parts[0]
    }
  } else {
    const split = splitUnstructuredAddress(trimmed)
    businessName = split.businessName
    street = split.street
    city = split.city
    state = split.state
  }

  if (!state && city) {
    state = inferStateFromCity(city)
  }

  return {
    raw: trimmed,
    normalized,
    businessName: businessName.trim(),
    street: street.trim(),
    city: city.trim(),
    state,
    zip,
  }
}

/** Heuristic: common load corridor cities when state omitted. */
function inferStateFromCity(city: string): string | null {
  const key = city.trim().toLowerCase()
  return KNOWN_CITY_STATE[key] || null
}

function looksLikeStreet(text: string): boolean {
  return (
    /^\d{1,6}\s/.test(text) ||
    /\b(?:I-\d{1,3}|Interstate|US Highway|Business Loop|Highway)\b/i.test(text)
  )
}

function streetVariants(street: string): string[] {
  if (!street) return []
  const variants = new Set<string>()
  variants.add(street)

  const expanded = expandInterstateNames(street)
  variants.add(expanded)

  const houseMatch = street.match(HOUSE_STREET_RE)
  if (houseMatch) {
    const [, num, rest] = houseMatch
    variants.add(`${num} ${expandInterstateNames(rest)}`)
    variants.add(expandInterstateNames(rest))
    variants.add(rest)
  } else if (/\b(?:I-\d|Interstate|US Highway)/i.test(street)) {
    variants.add(expandInterstateNames(street))
  }

  return [...variants].filter(Boolean)
}

function uniqueVariants(items: Array<{ id: string; query: string; city: string; street: string }>): Array<{ id: string; query: string; city: string; street: string }> {
  const seen = new Set<string>()
  const out: Array<{ id: string; query: string; city: string; street: string }> = []
  for (const item of items) {
    const key = `${item.query}|${item.city}|${item.street}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** Build ordered fallback search variants for the geocode route. */
export function buildGeocodeSearchVariants(input: {
  q?: string
  city?: string
  street?: string
  zip?: string
  state?: string | null
}): GeocodeSearchVariant[] {
  const rawQ = (input.q || '').trim()
  const parsed = rawQ ? parseNaturalLanguageQuery(rawQ) : null

  const city = (input.city || '').trim() || parsed?.city || ''
  const street = (input.street || '').trim() || parsed?.street || ''
  const zip = (input.zip || '').trim() || parsed?.zip || ''
  const state = input.state ?? parsed?.state ?? null
  const businessName = parsed?.businessName || ''

  const context: ParsedGeocodeQuery = parsed || {
    raw: rawQ,
    normalized: rawQ,
    businessName,
    street,
    city,
    state,
    zip: zip || null,
  }

  const stateName = state ? STATE_CODE_TO_NAME[state] : null
  const variants: Array<{ id: string; query: string; city: string; street: string }> = []

  if (rawQ) {
    variants.push({ id: 'raw', query: rawQ, city, street })
    if (parsed && parsed.normalized !== rawQ) {
      variants.push({ id: 'normalized', query: parsed.normalized, city, street })
    }
  }

  for (const sv of streetVariants(street)) {
    if (city && stateName) {
      variants.push({ id: 'street-city-state', query: `${sv}, ${city}, ${state}`, city, street: sv })
      variants.push({
        id: 'street-city-state-expanded',
        query: `${expandInterstateNames(sv)}, ${city}, ${stateName}`,
        city,
        street: sv,
      })
    }
    if (city) {
      variants.push({ id: 'street-city', query: `${sv}, ${city}`, city, street: sv })
      variants.push({
        id: 'street-city-expanded',
        query: `${expandInterstateNames(sv)}, ${city}, ${stateName || ''}`.replace(/,\s*$/, ''),
        city,
        street: sv,
      })
    }
  }

  if (businessName && city && state) {
    variants.push({
      id: 'business-city-state',
      query: `${businessName}, ${city}, ${state}`,
      city,
      street,
    })
    if (stateName) {
      variants.push({
        id: 'business-city-state-full',
        query: `${businessName}, ${city}, ${stateName}`,
        city,
        street,
      })
    }
  }

  if (businessName && city && !street) {
    variants.push({
      id: 'business-city',
      query: `${businessName}, ${city}`,
      city,
      street,
    })
    if (state && stateName) {
      variants.push({
        id: 'business-city-state-inferred',
        query: `${businessName}, ${city}, ${state}`,
        city,
        street,
      })
    }
  }

  if (zip) {
    variants.push({ id: 'zip', query: `${zip}, United States`, city, street })
  }

  if (city && stateName && !street) {
    variants.push({ id: 'city-state', query: `${city}, ${stateName}`, city, street })
  }

  if (!rawQ && city && stateName) {
    variants.push({
      id: 'structured-only',
      query: street ? `${street}, ${city}, ${stateName}` : `${city}, ${stateName}`,
      city,
      street,
    })
  }

  const deduped = uniqueVariants(variants).filter((v) => v.query.trim().length >= 3)

  return deduped.map((v) => ({
    ...v,
    state,
    zip,
    strategies:
      v.city && state && (v.street || v.id === 'structured-only')
        ? (['structured', 'freetext'] as const)
        : (['freetext', 'structured'] as const),
    context,
  }))
}

/** Tokenize for fuzzy business-name matching. */
export function tokenizeForMatch(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
}

const STOP_WORDS = new Set(['the', 'and', 'inc', 'llc', 'corp', 'company', 'plant'])

/** Normalize road names for fuzzy comparison. */
export function normalizeRoadName(road: string): string {
  return normalizeHighwayTokens(road)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Score how well a road name matches the query street. */
export function roadNamesMatch(queryStreet: string, resultRoad: string): boolean {
  const a = normalizeRoadName(queryStreet)
  const b = normalizeRoadName(resultRoad)
  if (!a || !b) return false
  if (a === b || a.includes(b) || b.includes(a)) return true

  const aTokens = a.split(' ').filter((t) => t.length > 2)
  const bTokens = new Set(b.split(' ').filter((t) => t.length > 2))
  const overlap = aTokens.filter((t) => bTokens.has(t)).length
  return overlap >= Math.min(2, aTokens.length)
}

export function resultCityName(addr: Record<string, string | undefined>): string {
  return cityFromAddressFields(addr)
}