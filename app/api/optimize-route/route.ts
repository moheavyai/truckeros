import { NextRequest, NextResponse } from 'next/server'
import { processPermitRequest, type LoadDetails } from '@/agents/permit-agent'
import { enrichOrToolsResponseWithEscorts } from '@/lib/enrich-route-escorts'
import { normalizeDrops } from '@/lib/location-stop'
import {
  getOrToolsOptimizeUrl,
  isAbortOrTimeoutError,
  isConnectionFailure,
} from '@/lib/ortools-config'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/optimize-route
 *
 * Thin proxy to the OR-Tools FastAPI service (default http://127.0.0.1:8000/optimize-route).
 * Forwards the same JSON body shape as /api/analyze-permit (LoadDetails + optional optimizationMode).
 *
 * On connection failure only (service unreachable), falls back to pure OSRM via the permit agent.
 * Timeouts and solver errors return a clear error — no silent OSRM fallback.
 */
/** Proxy timeout must exceed OR-Tools router timeout (default 150s). */
const ORTOOLS_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.ORTOOLS_TIMEOUT_MS) || 180_000
)

const FALLBACK_MESSAGE = 'OR-Tools service unreachable — used OSRM corridor routing'

export function buildLoadDetails(body: Record<string, unknown>): LoadDetails {
  const origin = (body.origin || {}) as Record<string, string>
  const destination = (body.destination || {}) as Record<string, string>

  const dropsResult = normalizeDrops(body.drops)
  if (!dropsResult.ok) {
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

function ortoolsErrorResponse(
  reason: 'timeout' | 'error',
  message: string,
  originalError?: string,
  status = reason === 'timeout' ? 504 : 502
) {
  return NextResponse.json(
    {
      status: 'error',
      error: message,
      fallback: false,
      ortoolsFailed: true,
      failureReason: reason,
      message,
      originalError: originalError || null,
    },
    { status }
  )
}

async function fallbackToOsrm(
  loadDetails: LoadDetails,
  reason: string,
  originalError?: string
) {
  console.warn('[optimize-route] OR-Tools unreachable, falling back to OSRM:', reason, originalError || '')

  const agentResult = await processPermitRequest(loadDetails)

  if (agentResult.status === 'invalid' || agentResult.options.length === 0) {
    return NextResponse.json(
      {
        status: 'error',
        error: agentResult.message || 'OSRM fallback could not produce a route',
        fallback: true,
        fallbackReason: reason,
        message: agentResult.message,
      },
      { status: 500 }
    )
  }

  const primary = agentResult.options[0]
  const alternatives = agentResult.options.slice(1)
  const fallbackNotes = [FALLBACK_MESSAGE, ...(primary.notes || [])]

  return NextResponse.json({
    status: 'ok',
    fallback: true,
    fallbackReason: reason,
    message: FALLBACK_MESSAGE,
    primary: {
      ...primary,
      routingEngine: 'osrm',
      routingEngineNote: 'OR-Tools optimization unavailable; used OSRM corridor routing.',
      notes: fallbackNotes,
    },
    alternatives,
    meta: {
      fallback: true,
      fallbackReason: reason,
      originalError: originalError || null,
      routingEngine: 'osrm',
    },
    loadDetails: agentResult.loadDetails,
  })
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ status: 'error', error: 'Invalid JSON body' }, { status: 400 })
  }

  let loadDetails: LoadDetails
  try {
    loadDetails = buildLoadDetails(body)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid drops payload'
    return NextResponse.json({ status: 'error', error: message }, { status: 400 })
  }

  const ortoolsServiceUrl = getOrToolsOptimizeUrl()

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), ORTOOLS_TIMEOUT_MS)
    const startMs = Date.now()
    console.log(`[optimize-route] calling OR-Tools url=${ortoolsServiceUrl} timeout_ms=${ORTOOLS_TIMEOUT_MS}`)

    let upstream: Response
    try {
      upstream = await fetch(ortoolsServiceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (fetchErr: unknown) {
      clearTimeout(timeoutId)
      const elapsed = Date.now() - startMs
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
      console.error(`[optimize-route] OR-Tools fetch failed after ${elapsed}ms:`, errMsg)

      if (isAbortOrTimeoutError(fetchErr)) {
        return ortoolsErrorResponse(
          'timeout',
          'OR-Tools optimization timed out. Try again or reduce route complexity.',
          errMsg
        )
      }

      if (isConnectionFailure(fetchErr)) {
        return fallbackToOsrm(loadDetails, 'unreachable', errMsg)
      }

      return ortoolsErrorResponse('error', 'OR-Tools optimization failed', errMsg)
    } finally {
      clearTimeout(timeoutId)
    }

    const elapsed = Date.now() - startMs
    console.log(`[optimize-route] OR-Tools responded in ${elapsed}ms status=${upstream.status}`)

    if (upstream.status === 504) {
      const errText = await upstream.text().catch(() => '')
      console.error('[optimize-route] OR-Tools timed out (504):', errText.slice(0, 500))
      return ortoolsErrorResponse(
        'timeout',
        'OR-Tools optimization timed out. Try again or reduce route complexity.',
        errText.slice(0, 300)
      )
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '')
      console.error(`[optimize-route] OR-Tools HTTP ${upstream.status}:`, errText.slice(0, 500))
      return ortoolsErrorResponse(
        'error',
        `OR-Tools optimization failed (HTTP ${upstream.status})`,
        `HTTP ${upstream.status}: ${errText.slice(0, 200)}`
      )
    }

    const data = await upstream.json()

    if (data?.status && data.status !== 'ok') {
      console.error('[optimize-route] OR-Tools non-ok status:', data.status, data.message || data.error)
      return ortoolsErrorResponse(
        'error',
        data.message || data.error || 'OR-Tools optimization failed',
        data.message || data.error || data.status
      )
    }

    const enriched = await enrichOrToolsResponseWithEscorts(data, {
      width: loadDetails.width,
      length: loadDetails.length,
      height: loadDetails.height,
      weight: loadDetails.weight,
    })

    return NextResponse.json(enriched)
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[optimize-route] Unexpected error:', errMsg)

    if (isAbortOrTimeoutError(error)) {
      return ortoolsErrorResponse(
        'timeout',
        'OR-Tools optimization timed out. Try again or reduce route complexity.',
        errMsg
      )
    }

    if (isConnectionFailure(error)) {
      try {
        return await fallbackToOsrm(loadDetails, 'unreachable', errMsg)
      } catch (fallbackErr: unknown) {
        const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
        console.error('[optimize-route] OSRM fallback also failed:', fbMsg)
        return NextResponse.json(
          { status: 'error', error: fbMsg || 'Optimization and OSRM fallback both failed' },
          { status: 500 }
        )
      }
    }

    return ortoolsErrorResponse('error', 'OR-Tools optimization failed', errMsg)
  }
}