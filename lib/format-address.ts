/**
 * US-oriented address formatting for portal prefill and Assist tiles.
 * Prefers structured street + city + state + zip; falls back to street-like
 * query text; otherwise "City, ST".
 */

export type PortalAddressParts = {
  street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  query?: string | null
}

/** Strip empty / placeholder fragments ("undefined", "null"). */
export function cleanAddressFragment(v: unknown): string {
  if (v == null) return ''
  const t = String(v).trim()
  if (!t || /^(undefined|null)$/i.test(t)) return ''
  return t
}

/**
 * Formats "City, ST" for portal prefill. Requires both city and state;
 * empty / null / "undefined" fragments → '' so checklist does not false-pass.
 */
export function formatPortalCityState(city: unknown, state: unknown): string {
  const c = cleanAddressFragment(city)
  const s = cleanAddressFragment(state)
  if (!c || !s) return ''
  return `${c}, ${s}`
}

/**
 * Heuristic: query looks like a street-level / full address rather than
 * plain "City, ST" or a business name alone.
 */
export function looksLikeFullAddress(query: string): boolean {
  const t = query.trim()
  if (!t) return false

  // Leading house / route number: "6851 MO 123…", "805 12th Street…"
  if (/^\d{1,6}\s+\S/.test(t)) return true

  // Number + common street/highway tokens
  if (
    /\d/.test(t) &&
    /\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|hwy|highway|route|rte|ct|court|cir|circle|pkwy|parkway)\b/i.test(
      t
    )
  ) {
    return true
  }

  // Three+ comma parts usually means street, city, state/zip
  const parts = t
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length >= 3) return true
  // "123 Main St, Springfield" style
  if (parts.length === 2 && /^\d{1,6}\s/.test(parts[0])) return true

  return false
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** City present as a comma segment or whole-word token (not a random substring). */
function streetHasCity(street: string, city: string): boolean {
  const c = city.trim()
  if (!c) return false
  const lower = c.toLowerCase()
  const segments = street.split(',').map((p) => p.trim())
  if (segments.some((seg) => seg.toLowerCase() === lower)) return true
  // "City ST" or "City ST ZIP" in a single segment
  const esc = escapeRegExp(c)
  if (segments.some((seg) => new RegExp(`^${esc}\\s+[A-Za-z]{2}\\b`, 'i').test(seg))) {
    return true
  }
  return new RegExp(`\\b${esc}\\b`, 'i').test(street)
}

/**
 * State present as a locality token (e.g. ", MO" / ", MO 65781"), not a
 * substring inside street or city words (Springfield/IN, North/OR, Brook/OK)
 * or a highway label mid-street ("6851 MO 123").
 */
function streetHasStateCode(street: string, state: string): boolean {
  const st = state.trim()
  if (!st) return false

  if (!/^[A-Za-z]{2}$/.test(st)) {
    return new RegExp(`\\b${escapeRegExp(st)}\\b`, 'i').test(street)
  }

  const code = st.toUpperCase()
  // Locality after comma: ", MO" or ", MO 65781" (optional trailing comma)
  if (
    new RegExp(`,\\s*${code}(?:\\s+\\d{5}(?:-\\d{4})?)?\\s*(?:,|$)`, 'i').test(street)
  ) {
    return true
  }
  // Trailing bare state or state+zip (no mid-street highway false positives)
  if (new RegExp(`(?:^|\\s)${code}(?:\\s+\\d{5}(?:-\\d{4})?)?\\s*$`, 'i').test(street)) {
    return true
  }
  return false
}

function streetHasZip(street: string, zip: string): boolean {
  const z = zip.trim()
  if (!z) return false
  return new RegExp(`(?:^|[,\\s])${escapeRegExp(z)}\\b`).test(street)
}

/**
 * Merge street with city/state/zip without duplicating locality already on street.
 * - city+state present, zip missing → append zip only
 * - city present, state missing → append ", ST" / ", ST ZIP"
 * - else → ", City, ST" / ", City, ST ZIP"
 */
function mergeStreetWithLocality(
  street: string,
  city: string,
  state: string,
  zip: string
): string {
  const hasCity = streetHasCity(street, city)
  const hasState = streetHasStateCode(street, state)
  const hasZip = !zip || streetHasZip(street, zip)

  if (hasCity && hasState) {
    return hasZip ? street : `${street} ${zip}`
  }

  if (hasCity && !hasState) {
    return zip ? `${street}, ${state} ${zip}` : `${street}, ${state}`
  }

  const tail = zip ? `${city}, ${state} ${zip}` : `${city}, ${state}`
  return `${street}, ${tail}`
}

/**
 * Build a single-line US address for portal copy / Assist tiles.
 * Priority:
 * 1. street + city + state (+ optional zip), with locality dedup on street
 * 2. query when it looks like a full address
 * 3. "City, ST" (optional zip after state) when both city and state exist
 * 4. non-street query (e.g. business name) as last resort; never city-alone or state-alone
 */
export function formatPortalAddress(parts: PortalAddressParts): string {
  const street = cleanAddressFragment(parts.street)
  const city = cleanAddressFragment(parts.city)
  const state = cleanAddressFragment(parts.state)
  const zip = cleanAddressFragment(parts.zip)
  const query = cleanAddressFragment(parts.query)

  if (street && city && state) {
    return mergeStreetWithLocality(street, city, state, zip)
  }

  if (street && (city || state)) {
    const bits = [street]
    if (city) bits.push(city)
    if (state && zip) bits.push(`${state} ${zip}`)
    else if (state) bits.push(state)
    else if (zip) bits.push(zip)
    return bits.join(', ')
  }

  if (street) {
    return street
  }

  if (query && looksLikeFullAddress(query)) {
    return query
  }

  if (city && state) {
    return zip ? `${city}, ${state} ${zip}` : `${city}, ${state}`
  }

  // Non-street query (e.g. business name) still better than blank for copy tiles.
  // City-alone / state-alone intentionally stay empty (completeness / prior rules).
  if (query) return query
  return ''
}

/**
 * Resolve address parts from a permit_requests row, loadDetails-shaped object,
 * or nested origin/destination stop (query/street/city/state/zip).
 */
export function resolvePortalAddressParts(
  request: Record<string, any> | null | undefined,
  role: 'origin' | 'destination'
): PortalAddressParts {
  if (!request || typeof request !== 'object') return {}

  const nestedRaw = request[role]
  const nested =
    nestedRaw && typeof nestedRaw === 'object' && !Array.isArray(nestedRaw)
      ? (nestedRaw as Record<string, any>)
      : {}

  return {
    street:
      nested.street ??
      request[`${role}_street`] ??
      nested.address ??
      request[`${role}_address`] ??
      null,
    city: nested.city ?? request[`${role}_city`] ?? null,
    state: nested.state ?? request[`${role}_state`] ?? null,
    zip:
      nested.zip ??
      request[`${role}_zip`] ??
      nested.postal_code ??
      request[`${role}_postal_code`] ??
      null,
    query: nested.query ?? request[`${role}_query`] ?? null,
  }
}
