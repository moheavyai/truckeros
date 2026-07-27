/**
 * Point MapLibre at a real JS worker asset before `new Map`.
 *
 * Next.js often resolves the default worker URL to a document route (MIME text/html),
 * which leaves the style stuck loading forever ("Loading map tiles…").
 *
 * Strategy:
 * 1) Prefer bundler asset URL (`?url`) when the toolchain emits a real JS file.
 * 2) Fall back to same-origin `/maplibre-gl-worker.mjs` from `public/` (copied from maplibre-gl).
 */

/** Same-origin worker served from Next `public/` (plus sibling maplibre-gl-shared.mjs). */
export const PUBLIC_MAPLIBRE_WORKER_PATH = '/maplibre-gl-worker.mjs'

/** Demotiles default style — reliable for local Next dev (no OpenFreeMap dependency). */
export const DEFAULT_MAP_STYLE = 'https://demotiles.maplibre.org/style.json'

/** Optional secondary style if demotiles (or env primary) fails before first load. */
export const FALLBACK_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

function extractSetWorkerUrl(mod: unknown): ((url: string) => void) | null {
  if (mod == null || (typeof mod !== 'object' && typeof mod !== 'function')) return null
  const rec = mod as Record<string, unknown> & { default?: unknown }
  if (typeof rec.setWorkerUrl === 'function') {
    return rec.setWorkerUrl as (url: string) => void
  }
  if (
    rec.default != null &&
    (typeof rec.default === 'object' || typeof rec.default === 'function')
  ) {
    const d = rec.default as Record<string, unknown>
    if (typeof d.setWorkerUrl === 'function') {
      return d.setWorkerUrl as (url: string) => void
    }
  }
  return null
}

function asAssetUrl(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (value != null && typeof value === 'object' && 'href' in value) {
    const href = (value as { href?: unknown }).href
    if (typeof href === 'string' && href.length > 0) return href
  }
  if (value != null && typeof value === 'object' && 'default' in value) {
    return asAssetUrl((value as { default: unknown }).default)
  }
  return null
}

/** Reject URLs that look like Next HTML document routes (the original MIME bug). */
export function isLikelyHtmlDocumentUrl(url: string): boolean {
  const lower = url.toLowerCase()
  if (lower.includes('text/html')) return true
  // Next app routes / data routes are not module scripts
  if (lower.includes('/_next/data/')) return true
  if (/\.html?($|\?)/i.test(url)) return true
  return false
}

/**
 * Configure MapLibre worker URL on the dynamic-imported module namespace.
 * Must run before `new Map(...)`.
 * @returns worker URL that was set, or null if setWorkerUrl unavailable
 */
export async function configureMaplibreWorker(mod: unknown): Promise<string | null> {
  const setWorkerUrl = extractSetWorkerUrl(mod)
  if (!setWorkerUrl) {
    console.warn('[RouteMap] setWorkerUrl not found on maplibre-gl module')
    return null
  }

  // 1) Bundler-emitted worker asset (webpack/turbopack ?url)
  try {
    const workerAsset = await import(
      /* webpackChunkName: "maplibre-worker-url" */
      'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
    )
    const url = asAssetUrl(workerAsset)
    if (url && !isLikelyHtmlDocumentUrl(url)) {
      setWorkerUrl(url)
      console.info('[RouteMap] maplibre worker url (bundler)', url)
      return url
    }
    if (url) {
      console.warn('[RouteMap] rejecting bundler worker url (looks like HTML)', url)
    }
  } catch (err) {
    console.warn('[RouteMap] maplibre worker ?url import failed; using public/', err)
  }

  // 2) Same-origin public static file (correct MIME from Next static serving)
  const publicUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${PUBLIC_MAPLIBRE_WORKER_PATH}`
      : PUBLIC_MAPLIBRE_WORKER_PATH
  setWorkerUrl(publicUrl)
  console.info('[RouteMap] maplibre worker url (public)', publicUrl)
  return publicUrl
}

/**
 * Primary map style: env override, else demotiles (reliable local default).
 */
export function resolveMapStyle(): string {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_MAP_STYLE_URL) {
    const trimmed = process.env.NEXT_PUBLIC_MAP_STYLE_URL.trim()
    if (trimmed) return trimmed
  }
  return DEFAULT_MAP_STYLE
}
