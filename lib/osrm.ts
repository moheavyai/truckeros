// lib/osrm.ts

export interface OSRMRoute {
  distance: number
  duration: number
  geometry: any
  steps?: any[]   // OSRM route steps (includes road names / highways)
}

export interface OSRMRouteResponse {
  routes: OSRMRoute[]
}

export async function getRoute(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number
): Promise<OSRMRouteResponse | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${originLon},${originLat};${destLon},${destLat}?overview=full&geometries=geojson&steps=true&alternatives=2`

    const res = await fetch(url)

    if (!res.ok) {
      console.error('OSRM request failed:', res.status)
      return null
    }

    const data = await res.json()

    if (!data.routes || data.routes.length === 0) {
      return null
    }

    let routes: OSRMRoute[] = data.routes.map((route: any) => ({
      distance: route.distance,
      duration: route.duration,
      geometry: route.geometry,
      steps: route.legs?.[0]?.steps || [],
    }))

    // Sort by distance ascending — shortest (usually best) first
    routes.sort((a, b) => a.distance - b.distance)

    return { routes }
  } catch (error) {
    console.error('Error calling OSRM:', error)
    return null
  }
}