export const DEFAULT_ORTOOLS_OPTIMIZE_URL = 'http://127.0.0.1:8000/optimize-route'
export const DEFAULT_ORTOOLS_HEALTH_URL = 'http://127.0.0.1:8000/health'
export const HEALTH_TIMEOUT_MS = 5_000

function readEnvUrl(envUrl?: string): string {
  return envUrl ?? process.env.ORTOOLS_SERVICE_URL ?? DEFAULT_ORTOOLS_OPTIMIZE_URL
}

/**
 * Resolves the OR-Tools optimize-route URL from env or default.
 * Malformed values fall back to DEFAULT_ORTOOLS_OPTIMIZE_URL.
 */
export function getOrToolsOptimizeUrl(envUrl?: string): string {
  const raw = readEnvUrl(envUrl)
  try {
    const url = new URL(raw)
    if (/\/health\/?$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/health\/?$/, '/optimize-route')
    } else if (!/\/optimize-route\/?$/.test(url.pathname)) {
      url.pathname = `${url.pathname.replace(/\/?$/, '')}/optimize-route`
    } else {
      url.pathname = url.pathname.replace(/\/optimize-route\/?$/, '/optimize-route')
    }
    return url.toString()
  } catch {
    return DEFAULT_ORTOOLS_OPTIMIZE_URL
  }
}

/**
 * Derives the OR-Tools /health URL from the optimize-route service URL.
 * Handles trailing slashes on /optimize-route/.
 */
export function getOrToolsHealthUrl(envUrl?: string): string {
  const raw = readEnvUrl(envUrl)
  try {
    const url = new URL(raw)
    if (/\/optimize-route\/?$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/optimize-route\/?$/, '/health')
    } else if (/\/health\/?$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/health\/?$/, '/health')
    } else {
      url.pathname = `${url.pathname.replace(/\/?$/, '')}/health`
    }
    return url.toString()
  } catch {
    return DEFAULT_ORTOOLS_HEALTH_URL
  }
}

export function formatHealthTimeoutMessage(timeoutMs: number = HEALTH_TIMEOUT_MS): string {
  const seconds = Math.round(timeoutMs / 1000)
  return `Health check timed out (${seconds}s)`
}

export function isAbortOrTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; message?: string; code?: string; cause?: { name?: string; message?: string } }
  const name = e.name || e.cause?.name || ''
  const msg = (e.message || e.cause?.message || '').toLowerCase()
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    e.code === 'ABORT_ERR' ||
    msg.includes('aborted') ||
    msg.includes('timeout')
  )
}

export function isConnectionFailure(err: unknown): boolean {
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

/** Maps upstream fetch errors to a safe client-facing message. */
export function mapOrToolsConnectionError(err: unknown, timeoutMs: number = HEALTH_TIMEOUT_MS): string {
  if (isAbortOrTimeoutError(err)) {
    return formatHealthTimeoutMessage(timeoutMs)
  }
  if (isConnectionFailure(err)) {
    return 'OR-Tools service unreachable — check that the service is running'
  }
  return 'OR-Tools service unreachable'
}