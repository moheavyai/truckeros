// lib/route-utils.ts

export interface RoutePoint {
  lat: number
  lon: number
}

/**
 * Sample points along a route geometry
 * (We can improve sampling density later)
 */
export function sampleRoutePoints(geometry: any, maxPoints: number = 8): RoutePoint[] {
  if (!geometry?.coordinates || geometry.coordinates.length === 0) {
    return []
  }

  const coords = geometry.coordinates
  const points: RoutePoint[] = []

  // Always include start and end
  points.push({ lat: coords[0][1], lon: coords[0][0] })

  // Sample points in between
  const step = Math.max(1, Math.floor(coords.length / maxPoints))

  for (let i = step; i < coords.length - 1; i += step) {
    points.push({
      lat: coords[i][1],
      lon: coords[i][0],
    })
  }

  // Always include destination
  points.push({
    lat: coords[coords.length - 1][1],
    lon: coords[coords.length - 1][0],
  })

  return points
}