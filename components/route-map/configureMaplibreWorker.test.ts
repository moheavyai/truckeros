import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  configureMaplibreWorker,
  DEFAULT_MAP_STYLE,
  FALLBACK_MAP_STYLE,
  isLikelyHtmlDocumentUrl,
  PUBLIC_MAPLIBRE_WORKER_PATH,
  resolveMapStyle,
} from './configureMaplibreWorker'

describe('resolveMapStyle', () => {
  const prev = process.env.NEXT_PUBLIC_MAP_STYLE_URL

  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_MAP_STYLE_URL
    else process.env.NEXT_PUBLIC_MAP_STYLE_URL = prev
  })

  it('defaults to demotiles (reliable Next dev style)', () => {
    delete process.env.NEXT_PUBLIC_MAP_STYLE_URL
    expect(resolveMapStyle()).toBe(DEFAULT_MAP_STYLE)
    expect(DEFAULT_MAP_STYLE).toContain('demotiles.maplibre.org')
  })

  it('uses trimmed NEXT_PUBLIC_MAP_STYLE_URL when set', () => {
    process.env.NEXT_PUBLIC_MAP_STYLE_URL = '  https://example.com/style.json  '
    expect(resolveMapStyle()).toBe('https://example.com/style.json')
  })

  it('ignores whitespace-only env and keeps demotiles default', () => {
    process.env.NEXT_PUBLIC_MAP_STYLE_URL = '   '
    expect(resolveMapStyle()).toBe(DEFAULT_MAP_STYLE)
  })

  it('OpenFreeMap liberty is the secondary fallback style', () => {
    expect(FALLBACK_MAP_STYLE).toContain('openfreemap.org')
  })
})

describe('isLikelyHtmlDocumentUrl', () => {
  it('flags Next data routes and .html', () => {
    expect(isLikelyHtmlDocumentUrl('/_next/data/build/page.json')).toBe(true)
    expect(isLikelyHtmlDocumentUrl('https://app/foo.html')).toBe(true)
    expect(isLikelyHtmlDocumentUrl('/maplibre-gl-worker.mjs')).toBe(false)
  })
})

describe('configureMaplibreWorker', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:3000' } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('calls setWorkerUrl on the module (public path when ?url unavailable)', async () => {
    const setWorkerUrl = vi.fn()
    const url = await configureMaplibreWorker({ setWorkerUrl, Map: class {} })
    expect(setWorkerUrl).toHaveBeenCalled()
    const arg = setWorkerUrl.mock.calls[0][0] as string
    // Either bundler asset or public static path
    expect(
      arg.includes(PUBLIC_MAPLIBRE_WORKER_PATH) ||
        arg.includes('maplibre-gl-worker') ||
        arg.startsWith('blob:') ||
        arg.includes('/_next/')
    ).toBe(true)
    expect(url).toBeTruthy()
    expect(isLikelyHtmlDocumentUrl(arg)).toBe(false)
  })

  it('returns null when setWorkerUrl missing', async () => {
    const url = await configureMaplibreWorker({ Map: class {} })
    expect(url).toBeNull()
  })

  it('reads setWorkerUrl from default export interop shape', async () => {
    const setWorkerUrl = vi.fn()
    await configureMaplibreWorker({ default: { setWorkerUrl } })
    expect(setWorkerUrl).toHaveBeenCalled()
  })
})
