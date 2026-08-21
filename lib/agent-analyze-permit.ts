/**
 * Shared analyze_permit execution for REST (/api/v1/tools/analyze-permit)
 * and MCP (/api/mcp). Handles geocode fallback + processPermitRequest.
 */

import { processPermitRequest, type LoadDetails } from '@/agents/permit-agent'
import { normalizeDrops } from '@/lib/location-stop'
import { extractAxleEquipmentFields } from '@/lib/build-load-details'
import { resolveLocationToCoords } from '@/lib/geocode-for-agent'

export type AnalyzePermitBody = Record<string, unknown>

export type AnalyzePermitSuccess = {
  ok: true
  geocode: {
    origin: {
      source: 'provided' | 'geocoded'
      lat: number
      lon: number
      display_name?: string
    }
    destination: {
      source: 'provided' | 'geocoded'
      lat: number
      lon: number
      display_name?: string
    }
  }
  result: Awaited<ReturnType<typeof processPermitRequest>>
}

export type AnalyzePermitFailure = {
  ok: false
  status: 400
  error: string
  geocode?: {
    origin: { ok: boolean; source?: string }
    destination: { ok: boolean; source?: string }
  }
}

export type AnalyzePermitOutcome = AnalyzePermitSuccess | AnalyzePermitFailure

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function locField(body: AnalyzePermitBody, side: 'origin' | 'destination') {
  const loc = (body[side] as Record<string, unknown> | undefined) || {}
  return {
    query: typeof loc.query === 'string' ? loc.query : '',
    street: typeof loc.street === 'string' ? loc.street : '',
    city: typeof loc.city === 'string' ? loc.city : '',
    state: typeof loc.state === 'string' ? loc.state : '',
    zip: typeof loc.zip === 'string' ? loc.zip : '',
  }
}

/**
 * Run permit analysis from an agent/MCP tool body.
 * Prefer explicit lat/lon; otherwise geocode city/state/address.
 */
export async function runAnalyzePermit(
  body: AnalyzePermitBody
): Promise<AnalyzePermitOutcome> {
  const dropsResult = normalizeDrops(body.drops)
  if (dropsResult.ok === false) {
    return { ok: false, status: 400, error: dropsResult.message }
  }

  const originFields = locField(body, 'origin')
  const destinationFields = locField(body, 'destination')

  const originResolved = await resolveLocationToCoords({
    ...originFields,
    lat: num(body.originLat),
    lon: num(body.originLon),
  })

  const destinationResolved = await resolveLocationToCoords({
    ...destinationFields,
    lat: num(body.destinationLat),
    lon: num(body.destinationLon),
  })

  if (!originResolved || !destinationResolved) {
    const missing: string[] = []
    if (!originResolved) missing.push('origin')
    if (!destinationResolved) missing.push('destination')
    return {
      ok: false,
      status: 400,
      error: `Could not geocode ${missing.join(' and ')}. Provide city+state, a full address, or explicit lat/lon.`,
      geocode: {
        origin: originResolved
          ? { ok: true, source: originResolved.source }
          : { ok: false },
        destination: destinationResolved
          ? { ok: true, source: destinationResolved.source }
          : { ok: false },
      },
    }
  }

  const weight =
    body.grossLoadedWeight != null && Number(body.grossLoadedWeight) > 0
      ? Number(body.grossLoadedWeight)
      : Number(body.weight)

  const loadDetails: LoadDetails = {
    origin: originFields,
    destination: destinationFields,
    weight,
    length: Number(body.length),
    width: Number(body.width),
    height: Number(body.height),
    originLat: originResolved.lat,
    originLon: originResolved.lon,
    destinationLat: destinationResolved.lat,
    destinationLon: destinationResolved.lon,
    drops: dropsResult.drops.length > 0 ? dropsResult.drops : undefined,
    manualRoute: Array.isArray(body.manualRoute) ? (body.manualRoute as string[]) : undefined,
    manualWaypoints: Array.isArray(body.manualWaypoints)
      ? (body.manualWaypoints as unknown[])
          .filter(
            (w): w is { lat: number; lon: number; name?: string; source?: string } =>
              !!w &&
              typeof w === 'object' &&
              Number.isFinite(Number((w as any).lat)) &&
              Number.isFinite(Number((w as any).lon))
          )
          .map((w: any) => ({
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
    vehicleInfo: body.vehicleInfo as LoadDetails['vehicleInfo'],
    routingEngine: body.routingEngine === 'graphhopper' ? 'graphhopper' : 'osrm',
    trailerLengthFt: num(body.trailerLengthFt),
    ...extractAxleEquipmentFields(body),
  }

  const result = await processPermitRequest(loadDetails)

  return {
    ok: true,
    geocode: {
      origin: {
        source: originResolved.source,
        lat: originResolved.lat,
        lon: originResolved.lon,
        ...(originResolved.displayName
          ? { display_name: originResolved.displayName }
          : {}),
      },
      destination: {
        source: destinationResolved.source,
        lat: destinationResolved.lat,
        lon: destinationResolved.lon,
        ...(destinationResolved.displayName
          ? { display_name: destinationResolved.displayName }
          : {}),
      },
    },
    result,
  }
}
