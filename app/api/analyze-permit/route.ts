import { NextRequest, NextResponse } from 'next/server'
import { processPermitRequest, type LoadDetails } from '@/agents/permit-agent'
import { normalizeDrops } from '@/lib/location-stop'
import { savePermitRequestForUser } from '@/lib/permit-requests'

/**
 * POST /api/analyze-permit
 *
 * Runs the full Permit Agent analysis (intelligent routing + state rules + DOT restrictions).
 *
 * Optional auto-save behavior:
 *   If the request body contains `autoSave: true` AND a valid Authorization: Bearer token
 *   is provided, the primary result will be automatically persisted via the shared
 *   save utility (which enforces the correct user_id from the JWT).
 *
 * This satisfies the architectural requirement that analysis endpoints can also
 * produce persisted records when desired, while the default human-approval flow
 * (used by /permit-test) continues to call /api/permit-requests explicitly.
 *
 * The save logic is delegated to lib/permit-requests.ts so we have a single
 * place that guarantees correct user ownership.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const dropsResult = normalizeDrops(body.drops)
    if (!dropsResult.ok) {
      return NextResponse.json(
        {
          status: 'invalid',
          message: dropsResult.message,
          error: dropsResult.message,
        },
        { status: 400 }
      )
    }

    // Map incoming form data to the LoadDetails shape expected by the agent
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
      weight: Number(body.weight),
      length: Number(body.length),
      width: Number(body.width),
      height: Number(body.height),
      originLat: body.originLat ? Number(body.originLat) : undefined,
      originLon: body.originLon ? Number(body.originLon) : undefined,
      destinationLat: body.destinationLat ? Number(body.destinationLat) : undefined,
      destinationLon: body.destinationLon ? Number(body.destinationLon) : undefined,
      drops: dropsResult.drops.length > 0 ? dropsResult.drops : undefined,
      // Support the "Change Route" manual override feature
      manualRoute: Array.isArray(body.manualRoute) ? body.manualRoute : undefined,
      // Thread specialInstructions (primary) or fallback string manualRoute for prefs (array manualRoute is for override only)
      specialInstructions: typeof body.specialInstructions === 'string' ? body.specialInstructions :
        (typeof body.manualRoute === 'string' ? body.manualRoute : undefined),
      mcNumber: body.mcNumber,
      dotNumber: body.dotNumber,
      vehicleInfo: body.vehicleInfo,
      // Routing engine choice (GraphHopper truck profile vs OSRM)
      routingEngine: body.routingEngine === 'graphhopper' ? 'graphhopper' : 'osrm',
      trailerLengthFt:
        body.trailerLengthFt != null ? Number(body.trailerLengthFt) : undefined,
    }

    const result = await processPermitRequest(loadDetails)

    // Optional auto-save path (used when caller wants analysis + persistence in one request)
    if (body.autoSave === true) {
      const authHeader = request.headers.get('authorization')

      if (authHeader && result.status === 'pending_review' && result.options?.length > 0) {
        try {
          const token = authHeader.replace(/^Bearer\s+/i, '').trim()

          // Build a save payload from the primary option + original input
          const primary = result.options[0]
          const savePayload = {
            origin_city: loadDetails.origin.city,
            origin_state: loadDetails.origin.state,
            destination_city: loadDetails.destination.city,
            destination_state: loadDetails.destination.state,
            weight: loadDetails.weight,
            length: loadDetails.length,
            width: loadDetails.width,
            height: loadDetails.height,
            route_corridor: primary.routeCorridor || [],
            permit_required_states: primary.permitRequiredStates || [],
            requires_permit: (primary.permitRequiredStates?.length || 0) > 0,
            reasons: primary.reasons || [],
            notes: primary.notes || [],
            estimated_cost: primary.estimatedCost || 0,
            cost_breakdown: primary.costBreakdown || null,
            distance_miles: primary.distanceMiles || null,
            duration_hours: primary.durationHours || null,
          }

          const saved = await savePermitRequestForUser(savePayload, token)

          // Return both the analysis and the saved database record
          return NextResponse.json({
            ...result,
            saved: true,
            savedRecord: saved,
          })
        } catch (saveErr: any) {
          console.warn('[analyze-permit] autoSave failed (analysis still succeeded):', saveErr.message)
          // Return the analysis result even if auto-save failed — user can still save manually
          return NextResponse.json({
            ...result,
            saved: false,
            saveError: saveErr.message,
          })
        }
      }
    }

    // Normal analysis-only response (current default behavior for the test UI)
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[analyze-permit] Error:', error)
    return NextResponse.json(
      {
        status: 'invalid',
        message: error?.message || 'Permit analysis failed',
        error: error?.message || 'Internal error processing request',
      },
      { status: 500 }
    )
  }
}