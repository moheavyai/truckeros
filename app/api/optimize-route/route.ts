import { NextRequest, NextResponse } from 'next/server'
import { processPermitRequest, type LoadDetails } from '@/agents/permit-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/optimize-route
 *
 * Thin proxy to the OR-Tools FastAPI service (default http://localhost:8001/optimize-route).
 * Forwards the same JSON body shape as /api/analyze-permit (LoadDetails + optional optimizationMode).
 *
 * On connection failure only (service unreachable), falls back to pure OSRM via the permit agent.
 * Timeouts and solver errors return a clear error — no silent OSRM fallback.
 */
const ORTOOLS_SERVICE_URL =
  process.env.ORTOOLS_SERVICE_URL || 'http://localhost:8001/optimize-route'

/** Proxy timeout must exceed OR-Tools router timeout (default 150s). */
const ORTOOLS_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.ORTOOLS_TIMEOUT_MS) || 180_000
)

const FALLBACK_MESSAGE = 'OR-Tools service unreachable — used OSRM corridor routing'

function buildLoadDetails(body: Record<string, unknown>): LoadDetails {
  const origin = (body.origin || {}) as Record<string, string>
  const destination = (body.destination || {}) as Record<string, string>

  return {
    origin: {
      street: origin.street || '',
      city: origin.city || '',
      state: origin.state || '',
      zip: origin.zip || '',
    },
    destination: {
      street: destination.street || '',
      city: destination.city || '',
      state: destination.state || '',
      zip: destination.zip || '',
    },
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
  }
}

function isAbortOrTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; message?: string; code?: string; cause?: { name?: string } }
  const name = e.name || e.cause?.name || ''
  const msg = (e.message || '').toLowerCase()
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    e.code === 'ABORT_ERR' ||
    msg.includes('aborted') ||
    msg.includes('timeout')
  )
}

function isConnectionFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  if (isAbortOrTimeoutError(err)) return false
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } }
  const code = e.code || e.cause?.code || ''
  const msg = (e.message || e.cause?.message || '').toLowerCase()
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    msg.includes('econnrefused') ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  )
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

  const loadDetails = buildLoadDetails(body)

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), ORTOOLS_TIMEOUT_MS)
    const startMs = Date.now()
    console.log(`[optimize-route] calling OR-Tools timeout_ms=${ORTOOLS_TIMEOUT_MS}`)

    let upstream: Response
    try {
      upstream = await fetch(ORTOOLS_SERVICE_URL, {
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

    return NextResponse.json(data)
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