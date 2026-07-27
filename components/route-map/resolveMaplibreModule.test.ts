/**
 * Unit tests for maplibre-gl import interop resolve (no WebGL).
 */
import { describe, expect, it } from 'vitest'
import { isMaplibreRuntime, resolveMaplibreModule } from './resolveMaplibreModule'

function fakeRuntime(label = 'ok') {
  const Map = function MapCtor() {
    return { label, kind: 'Map' }
  }
  const Marker = function MarkerCtor() {
    return { label, kind: 'Marker' }
  }
  const Popup = function PopupCtor() {
    return { label, kind: 'Popup' }
  }
  const NavigationControl = function NavCtor() {
    return { label, kind: 'NavigationControl' }
  }
  const LngLatBounds = function BoundsCtor() {
    return { label, kind: 'LngLatBounds' }
  }
  return { Map, Marker, Popup, NavigationControl, LngLatBounds }
}

describe('resolveMaplibreModule', () => {
  it('resolves named-export namespace (mod.Map)', () => {
    const ns = fakeRuntime('named')
    expect(resolveMaplibreModule(ns)).toBe(ns)
  })

  it('resolves default export object { default: { Map, ... } }', () => {
    const runtime = fakeRuntime('default')
    expect(resolveMaplibreModule({ default: runtime })).toBe(runtime)
  })

  it('skips incomplete truthy default and uses namespace Map', () => {
    const ns = fakeRuntime('namespace')
    const mod = { default: { some: 'stub' }, ...ns }
    // Spreading puts Map on mod; incomplete default must not win
    expect(resolveMaplibreModule(mod)).toBe(mod)
    expect(isMaplibreRuntime(mod.default)).toBe(false)
  })

  it('returns null when Map is missing', () => {
    expect(resolveMaplibreModule({})).toBeNull()
    expect(resolveMaplibreModule({ default: {} })).toBeNull()
    expect(resolveMaplibreModule(null)).toBeNull()
    expect(resolveMaplibreModule(undefined)).toBeNull()
  })

  it('returns null when Map exists but other constructors missing', () => {
    const MapOnly = { Map: function Map() {} }
    expect(resolveMaplibreModule(MapOnly)).toBeNull()
    expect(resolveMaplibreModule({ default: MapOnly })).toBeNull()
  })

  it('resolves nested default.default interop', () => {
    const runtime = fakeRuntime('nested')
    expect(resolveMaplibreModule({ default: { default: runtime } })).toBe(runtime)
  })

  it('isMaplibreRuntime requires all constructors as functions', () => {
    expect(isMaplibreRuntime(fakeRuntime())).toBe(true)
    expect(isMaplibreRuntime({ Map: class {} })).toBe(false)
    expect(isMaplibreRuntime({ Map: 1, Marker: 1 })).toBe(false)
  })
})
