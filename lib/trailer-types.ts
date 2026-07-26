/**
 * lib/trailer-types.ts
 *
 * Default trailer type options + browser custom-list persistence (localStorage).
 * Free-text trailer_type on equipment remains the source of truth in the DB;
 * this module supplies the smart dropdown options and role classification.
 */

export const DEFAULT_TRAILER_TYPES = [
  'Flatbed',
  'Step Deck',
  'Double Drop',
  'RGN',
  'Jeep',
  'Flip',
  'Stinger',
] as const

export type DefaultTrailerType = (typeof DEFAULT_TRAILER_TYPES)[number]

/** localStorage key for user-added trailer types (browser-local). */
export const CUSTOM_TRAILER_TYPES_STORAGE_KEY = 'truckeros.customTrailerTypes.v1'

/** Cap browser custom trailer-type list (oldest dropped when exceeded). */
export const MAX_CUSTOM_TRAILER_TYPES = 50

/** Short UI hint: flip/stinger vs jeep coupling (show for booster/rear-pin roles). */
export const TRAILER_TYPE_COUPLING_HINT =
  'Jeep/booster: kingpin. Flip/stinger: pins to rear of an RGN.'

/** Compact hint for main-deck types only. */
export const TRAILER_TYPE_MAIN_HINT =
  'Deck types use kingpin / 5th-wheel geometry.'

export type TrailerRole = 'main' | 'jeep' | 'flip' | 'stinger' | 'unknown'

/** Normalize for comparison: trim, collapse spaces, lower-case. */
export function normalizeTrailerTypeLabel(value: unknown): string {
  if (value == null) return ''
  return String(value)
    .trim()
    .replace(/\s+/g, ' ')
}

/** Title-case-ish normalize for display / save. */
export function formatTrailerTypeLabel(value: unknown): string {
  const raw = normalizeTrailerTypeLabel(value)
  if (!raw) return ''
  // Keep common acronyms
  const upper = raw.toUpperCase()
  if (upper === 'RGN') return 'RGN'
  return raw
    .split(' ')
    .map((w) => {
      if (!w) return w
      const u = w.toUpperCase()
      if (u === 'RGN') return 'RGN'
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(' ')
}

/**
 * Classify equipment trailer_type into a structural role for axle grouping.
 * Jeep = kingpin/5th-wheel booster; flip/stinger = rear pin on RGN; else main deck.
 */
export function classifyTrailerRole(trailerType: unknown): TrailerRole {
  const n = normalizeTrailerTypeLabel(trailerType).toLowerCase()
  if (!n) return 'unknown'
  // Jeep / booster / dolly aliases (kingpin–5th-wheel boosters)
  if (
    /\bjeep\b/.test(n) ||
    n === 'jeep' ||
    /\bbooster\b/.test(n) ||
    /\bdolly\b/.test(n) ||
    /\bjeep\s*dolly\b/.test(n)
  ) {
    return 'jeep'
  }
  if (/\bflip\b/.test(n) || n === 'flip' || n.includes('flip axle')) return 'flip'
  if (/\bstinger\b/.test(n) || n === 'stinger') return 'stinger'
  if (
    n.includes('flatbed') ||
    n.includes('step deck') ||
    n.includes('stepdeck') ||
    n.includes('double drop') ||
    n.includes('lowboy') ||
    n === 'rgn' ||
    n.includes('rgn') || // "Stretch RGN", "RGN trailer", etc.
    n.includes('removable gooseneck') ||
    n.includes('gooseneck')
  ) {
    return 'main'
  }
  return 'unknown'
}

export function isRearPinTrailerType(trailerType: unknown): boolean {
  const role = classifyTrailerRole(trailerType)
  return role === 'flip' || role === 'stinger'
}

export function isKingpinBoosterTrailerType(trailerType: unknown): boolean {
  return classifyTrailerRole(trailerType) === 'jeep'
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && (globalThis as { localStorage?: Storage }).localStorage) {
      return (globalThis as { localStorage: Storage }).localStorage
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
  } catch {
    return null
  }
  return null
}

function readCustomFromStorage(): string[] {
  const storage = getLocalStorage()
  if (!storage) return []
  try {
    const raw = storage.getItem(CUSTOM_TRAILER_TYPES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((v) => formatTrailerTypeLabel(v))
      .filter((v) => v.length > 0)
  } catch {
    return []
  }
}

function writeCustomToStorage(list: string[]): void {
  const storage = getLocalStorage()
  if (!storage) return
  try {
    storage.setItem(CUSTOM_TRAILER_TYPES_STORAGE_KEY, JSON.stringify(list))
  } catch {
    // ignore quota / private mode
  }
}

/** Default + custom options, de-duplicated (case-insensitive), defaults first. */
export function getTrailerTypeOptions(customExtra: string[] = []): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (label: string) => {
    const formatted = formatTrailerTypeLabel(label)
    if (!formatted) return
    const key = formatted.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(formatted)
  }
  for (const d of DEFAULT_TRAILER_TYPES) push(d)
  for (const c of customExtra) push(c)
  for (const c of readCustomFromStorage()) push(c)
  return out
}

/**
 * Persist a user-typed trailer type into the custom list when it is not already
 * a default or existing custom entry. Returns the formatted label to store on equipment.
 */
export function saveCustomTrailerType(value: unknown): string {
  const formatted = formatTrailerTypeLabel(value)
  if (!formatted) return ''

  const defaults = new Set(DEFAULT_TRAILER_TYPES.map((d) => d.toLowerCase()))
  if (defaults.has(formatted.toLowerCase())) return formatted

  const current = readCustomFromStorage()
  const exists = current.some((c) => c.toLowerCase() === formatted.toLowerCase())
  if (!exists) {
    // Cap list; drop oldest entries when over MAX_CUSTOM_TRAILER_TYPES.
    const next = [...current, formatted]
    writeCustomToStorage(
      next.length > MAX_CUSTOM_TRAILER_TYPES
        ? next.slice(next.length - MAX_CUSTOM_TRAILER_TYPES)
        : next
    )
  }
  return formatted
}

/** Pure helper for tests / SSR: merge defaults + custom without touching storage. */
export function mergeTrailerTypeOptions(
  defaults: readonly string[],
  custom: readonly string[]
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const label of [...defaults, ...custom]) {
    const formatted = formatTrailerTypeLabel(label)
    if (!formatted) continue
    const key = formatted.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(formatted)
  }
  return out
}
