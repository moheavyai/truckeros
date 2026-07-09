import { NextResponse } from 'next/server'
import {
  formatHealthTimeoutMessage,
  getOrToolsHealthUrl,
  HEALTH_TIMEOUT_MS,
  mapOrToolsConnectionError,
} from '@/lib/ortools-config'

export const dynamic = 'force-dynamic'

export async function GET() {
  const healthUrl = getOrToolsHealthUrl()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  const startMs = Date.now()

  console.log(`[ortools-health] probing ${healthUrl} timeout_ms=${HEALTH_TIMEOUT_MS}`)

  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timeoutId)

    const elapsed = Date.now() - startMs
    console.log(`[ortools-health] responded in ${elapsed}ms status=${res.status}`)

    if (!res.ok) {
      console.warn(`[ortools-health] non-ok HTTP ${res.status} from ${healthUrl}`)
      return NextResponse.json({
        connected: false,
        status: 'unreachable',
        message: 'OR-Tools service unreachable',
      })
    }

    const data = (await res.json().catch(() => ({}))) as {
      status?: string
      version?: string
      buildId?: string
      service?: string
    }

    if (data.status !== 'ok') {
      console.warn(
        `[ortools-health] unexpected body status=${String(data.status)} service=${String(data.service)}`
      )
      return NextResponse.json({
        connected: false,
        status: 'unreachable',
        message: 'OR-Tools service returned an unexpected health response',
      })
    }

    console.log(
      `[ortools-health] connected service=${data.service || 'or-tools'} version=${data.version || '?'} buildId=${data.buildId || '?'}`
    )
    return NextResponse.json({
      connected: true,
      status: 'connected',
      message: 'Service healthy',
      version: data.version || null,
      buildId: data.buildId || null,
    })
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    const elapsed = Date.now() - startMs
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[ortools-health] probe failed after ${elapsed}ms:`, errMsg)

    return NextResponse.json({
      connected: false,
      status: 'unreachable',
      message: mapOrToolsConnectionError(err, HEALTH_TIMEOUT_MS),
    })
  }
}