/**
 * Snap a geocoded point to the nearest state highway (interstate, US, or state route)
 * so local/county permits are not required by default for origin/destination.
 */

const OSRM_BASE = 'https://router.project-osrm.org'

function isStateHighway(text?: string): boolean {
  const t = (text || '').trim()
  if (!t) return false
  return (
    /\bI[\s-]?\d{1,3}\b/i.test(t) ||
    /\bUS[\s-]?\d{1,3}\b/i.test(t) ||
    /\b[A-Z]{2}[\s-]?\d{1,4}\b/.test(t)
  )
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function offsetPoint(lat: number, lon: number, km: number, bearingDeg: number): { lat: number; lon: number } {
  const R = 6371
  const br = (bearingDeg * Math.PI) / 180
  const lat1 = (lat * Math.PI) / 180
  const lon1 = (lon * Math.PI) / 180
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(km / R) + Math.cos(lat1) * Math.sin(km / R) * Math.cos(br)
  )
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(br) * Math.sin(km / R) * Math.cos(lat1),
      Math.cos(km / R) - Math.sin(lat1) * Math.sin(lat2)
    )
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI }
}

async function probeRouteForHighway(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): Promise<{ lat: number; lon: number; highway: string } | null> {
  const url = `${OSRM_BASE}/route/v1/driving/${fromLon.toFixed(6)},${fromLat.toFixed(6)};${toLon.toFixed(6)},${toLat.toFixed(6)}?overview=false&steps=true&alternatives=false`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const steps = data?.routes?.[0]?.legs?.[0]?.steps
    if (!Array.isArray(steps)) return null
    for (const step of steps.slice(0, 10)) {
      const refText = `${step.ref || ''} ${step.name || ''}`
      if (!isStateHighway(refText)) continue
      const loc = step.maneuver?.location
      if (Array.isArray(loc) && loc.length >= 2) {
        return { lat: loc[1], lon: loc[0], highway: refText.trim() }
      }
    }
  } catch {
    return null
  }
  return null
}

export type SnapResult = { lat: number; lon: number; snapped: boolean; highway?: string }

/**
 * Snap to closest point on a state highway by probing short OSRM routes in radial directions.
 */
export async function snapToStateHighway(lat: number, lon: number): Promise<SnapResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { lat, lon, snapped: false }
  }

  let best: SnapResult | null = null
  let bestDist = Infinity

  for (const km of [3, 8, 15, 25, 40]) {
    for (let bearing = 0; bearing < 360; bearing += 45) {
      const sample = offsetPoint(lat, lon, km, bearing)
      const hit = await probeRouteForHighway(lat, lon, sample.lat, sample.lon)
      if (!hit) continue
      const d = haversineM(lat, lon, hit.lat, hit.lon)
      if (d < bestDist) {
        bestDist = d
        best = { lat: hit.lat, lon: hit.lon, snapped: true, highway: hit.highway }
      }
    }
  }

  return best || { lat, lon, snapped: false }
}