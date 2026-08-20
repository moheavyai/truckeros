/**
 * POST /api/v1/tools/analyze-permit
 *
 * Agent-facing entry point for the MoHeavy Permit Engine.
 * Reuses processPermitRequest. Auth via API key (mh_live_...) or user JWT.
 * Required scope: analyze_permit
 */

import { NextRequest, NextResponse } from 'next/server'
import { processPermitRequest, type LoadDetails } from '@/agents/permit-agent'
import { normalizeDrops } from '@/lib/location-stop'
import { extractAxleEquipmentFields } from '@/lib/build-load-details'
import {
  authenticateAgentRequest,
  recordAgentUsage,
} from '@/lib/agent-api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOOL_NAME = 'analyze_permit'

export async function POST(request: NextRequest) {
  const started = Date.now()
  let organizationId: string | null = null
  let apiKeyId: string | null = null
  let statusCode = 500

  try {
    const auth = await authenticateAgentRequest(request)
    // Explicit === false so TypeScript narrows to AgentAuthFailure (has status/error)
    if (auth.ok === false) {
      statusCode = auth.status
      return NextResponse.json(
        { ok: false, error: auth.error, tool: TOOL_NAME },
        { status: auth.status }
      )
    }

    if (!auth.scopes.includes(TOOL_NAME)) {
      statusCode = 403
      return NextResponse.json(
        {
          ok: false,
          error: `API key is missing required scope: ${TOOL_NAME}`,
          tool: TOOL_NAME,
        },
        { status: 403 }
      )
    }

    organizationId = auth.organizationId
    apiKeyId = auth.apiKeyId

    let body: any
    try {
      body = await request.json()
    } catch {
      statusCode = 400
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON body', tool: TOOL_NAME },
        { status: 400 }
      )
    }

    const dropsResult = normalizeDrops(body.drops)
    if (dropsResult.ok === false) {
      statusCode = 400
      return NextResponse.json(
        { ok: false, error: dropsResult.message, tool: TOOL_NAME },
        { status: 400 }
      )
    }

    const loadDetails: LoadDetails = {
      origin: {
        query: body.origin?.query || '',
        street: body.origin?.street || '',
        city: body.origin?.city || '',
        state: body.origin?.state || '',
        zip: body.origin?.zip || '',
      },
      destination: {
        query: body.destination?.query || '',
        street: body.destination?.street || '',
        city: body.destination?.city || '',
        state: body.destination?.state || '',
        zip: body.destination?.zip || '',
      },
      weight:
        body.grossLoadedWeight != null && Number(body.grossLoadedWeight) > 0
          ? Number(body.grossLoadedWeight)
          : Number(body.weight),
      length: Number(body.length),
      width: Number(body.width),
      height: Number(body.height),
      originLat: body.originLat != null ? Number(body.originLat) : undefined,
      originLon: body.originLon != null ? Number(body.originLon) : undefined,
      destinationLat:
        body.destinationLat != null ? Number(body.destinationLat) : undefined,
      destinationLon:
        body.destinationLon != null ? Number(body.destinationLon) : undefined,
      drops: dropsResult.drops.length > 0 ? dropsResult.drops : undefined,
      manualRoute: Array.isArray(body.manualRoute) ? body.manualRoute : undefined,
      manualWaypoints: Array.isArray(body.manualWaypoints)
        ? body.manualWaypoints
            .filter(
              (w: unknown): w is { lat: number; lon: number; name?: string; source?: string } =>
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
      mcNumber: body.mcNumber,
      dotNumber: body.dotNumber,
      vehicleInfo: body.vehicleInfo,
      routingEngine: body.routingEngine === 'graphhopper' ? 'graphhopper' : 'osrm',
      trailerLengthFt:
        body.trailerLengthFt != null ? Number(body.trailerLengthFt) : undefined,
      ...extractAxleEquipmentFields(body as Record<string, unknown>),
    }

    const result = await processPermitRequest(loadDetails)

    statusCode = 200
    const latencyMs = Date.now() - started

    void recordAgentUsage({
      organizationId,
      apiKeyId,
      tool: TOOL_NAME,
      statusCode,
      latencyMs,
      requestId: request.headers.get('x-request-id'),
    })

    return NextResponse.json({
      ok: true,
      tool: TOOL_NAME,
      organization_id: organizationId,
      result,
    })
  } catch (error: any) {
    console.error('[v1/tools/analyze-permit] Error:', error)
    statusCode = 500
    const latencyMs = Date.now() - started

    void recordAgentUsage({
      organizationId,
      apiKeyId,
      tool: TOOL_NAME,
      statusCode,
      latencyMs,
      requestId: request.headers.get('x-request-id'),
    })

    return NextResponse.json(
      {
        ok: false,
        tool: TOOL_NAME,
        error: error?.message || 'Permit analysis failed',
      },
      { status: 500 }
    )
  }
}
