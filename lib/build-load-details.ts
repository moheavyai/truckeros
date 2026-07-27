import type { LoadDetails } from '@/agents/permit-agent'
import { normalizeDrops } from '@/lib/location-stop'
import type { Tractor, Trailer } from '@/types/equipment'

/**
 * Map optional equipment / axle fields from an analyze or optimize request body.
 */
export function extractAxleEquipmentFields(body: Record<string, unknown>): Pick<
  LoadDetails,
  'axles' | 'axleWeights' | 'equipment'
> {
  const axles =
    body.axles != null && Number.isFinite(Number(body.axles))
      ? Number(body.axles)
      : undefined

  let axleWeights: number[] | undefined
  if (Array.isArray(body.axleWeights)) {
    axleWeights = body.axleWeights.map((w) => Number(w) || 0)
  }

  let equipment: LoadDetails['equipment']
  const rawEq = body.equipment as
    | { tractor?: Partial<Tractor> | null; trailers?: (Partial<Trailer> | null)[] }
    | null
    | undefined
  // Also accept rig-shaped snapshots from permit-test (tractor + trailers at top level of equipment or rig)
  const rig = (body.rig || body.selectedRig || rawEq) as
    | { tractor?: Partial<Tractor> | null; trailers?: (Partial<Trailer> | null)[] }
    | null
    | undefined

  if (rig && (rig.tractor || (Array.isArray(rig.trailers) && rig.trailers.length > 0))) {
    equipment = {
      tractor: rig.tractor ?? null,
      trailers: Array.isArray(rig.trailers) ? rig.trailers : [],
    }
  } else if (rawEq && (rawEq.tractor || (Array.isArray(rawEq.trailers) && rawEq.trailers.length > 0))) {
    equipment = {
      tractor: rawEq.tractor ?? null,
      trailers: Array.isArray(rawEq.trailers) ? rawEq.trailers : [],
    }
  }

  return { axles, axleWeights, equipment }
}

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
  const axleFields = extractAxleEquipmentFields(body)

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
    // Prefer grossLoadedWeight when provided (axle UI) so scale checks match permit-test form.
    weight:
      body.grossLoadedWeight != null && Number(body.grossLoadedWeight) > 0
        ? Number(body.grossLoadedWeight)
        : Number(body.weight),
    length: Number(body.length),
    width: Number(body.width),
    height: Number(body.height),
    originLat: body.originLat != null ? Number(body.originLat) : undefined,
    originLon: body.originLon != null ? Number(body.originLon) : undefined,
    destinationLat: body.destinationLat != null ? Number(body.destinationLat) : undefined,
    destinationLon: body.destinationLon != null ? Number(body.destinationLon) : undefined,
    manualRoute: Array.isArray(body.manualRoute) ? (body.manualRoute as string[]) : undefined,
    manualWaypoints: Array.isArray(body.manualWaypoints)
      ? (body.manualWaypoints as Array<{ lat: number; lon: number; name?: string; source?: string }>)
          .filter(
            (w) =>
              w != null &&
              typeof w === 'object' &&
              Number.isFinite(Number(w.lat)) &&
              Number.isFinite(Number(w.lon))
          )
          .map((w) => ({
            lat: Number(w.lat),
            lon: Number(w.lon),
            ...(typeof w.name === 'string' ? { name: w.name } : {}),
            ...(typeof w.source === 'string' ? { source: w.source } : {}),
          }))
      : undefined,
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
    ...axleFields,
  }
}
