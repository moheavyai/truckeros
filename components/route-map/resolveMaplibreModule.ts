/**
 * Resolve maplibre-gl module shape under webpack/Next ESM–CJS interop.
 * Pure (no maplibre import) so unit tests cover default vs named export cases.
 */

/** Runtime MapLibre namespace used by RouteMap after interop resolve. */
export type MaplibreRuntime = {
  Map: new (options?: object) => unknown
  Marker: new (options?: object) => unknown
  Popup: new (options?: object) => unknown
  NavigationControl: new (options?: object) => unknown
  LngLatBounds: new (...args: unknown[]) => unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && (typeof value === 'object' || typeof value === 'function')
}

/** True when candidate exposes the constructors RouteMap needs. */
export function isMaplibreRuntime(candidate: unknown): candidate is MaplibreRuntime {
  if (!isRecord(candidate)) return false
  return (
    typeof candidate.Map === 'function' &&
    typeof candidate.Marker === 'function' &&
    typeof candidate.Popup === 'function' &&
    typeof candidate.NavigationControl === 'function' &&
    typeof candidate.LngLatBounds === 'function'
  )
}

/**
 * Pick the first usable MapLibre runtime from import() result.
 * Order: mod.default → mod → mod.default.default (nested interop).
 * Prefer a candidate with all constructors; never trust a truthy incomplete default alone.
 */
export function resolveMaplibreModule(mod: unknown): MaplibreRuntime | null {
  if (!isRecord(mod)) return null

  const raw = mod as Record<string, unknown> & { default?: unknown }
  const nestedDefault =
    isRecord(raw.default) && 'default' in raw.default
      ? (raw.default as { default?: unknown }).default
      : undefined

  const candidates: unknown[] = [raw.default, raw, nestedDefault]
  const seen = new Set<unknown>()

  for (const candidate of candidates) {
    if (candidate == null || seen.has(candidate)) continue
    seen.add(candidate)
    if (isMaplibreRuntime(candidate)) return candidate
  }

  return null
}
