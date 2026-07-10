import type { LoadDetails } from '@/agents/permit-agent'
import { normalizeDrops } from '@/lib/location-stop'

/**
 * Map an optimize-route / analyze-permit style JSON body to LoadDetails.
 * Throws Error with a user-facing message when drops are invalid.
 */
export function buildLoadDetails(body: Record<string, unknown>): LoadDetails {
  const origin = (body.origin || {}) as Record<string, string>
  const destination = (body.destination || {}) as Record<string, string>

  const dropsResult = normalizeDrops(body.drops)
  if (dropsResult.ok === false) {
    throw new Error(dropsResult.message)
  }
  const drops = dropsResult.drops

  return {
    origin: {
      query: origin.query || '',
      street: origin.street || '',
      city: origin.city || '',
      state: origin.state || '',
      zip: origin.zip || '',
    },
    destination: {
      query: destination.query || '',
      street: destination.street || '',
      city: destination.city || '',
      state: destination.state || '',
      zip: destination.zip || '',
    },
    drops: drops.length > 0 ? drops : undefined,
    weight: Number(body.weight),
    length: Number(body.length),
    width: Number(body.width),
    height: Number(body.height),
    originLat: body.originLat != null ? Number(body.originLat) : undefined,
    originLon: body.originLon != null ? Number(body.originLon) : undefined,
    destinationLat: body.destinationLat != null ? Number(body.destinationLat) : undefined,
    destinationLon: body.destinationLon != null ? Number(body.destinationLon) : undefined,
    manualRoute: Array.isArray(body.manualRoute) ? (body.manualRoute as string[]) : undefined,
    specialInstructions:
      typeof body.specialInstructions === 'string'
        ? body.specialInstructions
        : typeof body.manualRoute === 'string'
          ? body.manualRoute
          : undefined,
    mcNumber: body.mcNumber as string | undefined,
    dotNumber: body.dotNumber as string | undefined,
    vehicleInfo: body.vehicleInfo as string | undefined,
    routingEngine: 'osrm',
    trailerLengthFt:
      body.trailerLengthFt != null ? Number(body.trailerLengthFt) : undefined,
  }
}
