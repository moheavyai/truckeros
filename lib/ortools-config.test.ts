import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_ORTOOLS_HEALTH_URL,
  DEFAULT_ORTOOLS_OPTIMIZE_URL,
  formatHealthTimeoutMessage,
  getOrToolsHealthUrl,
  getOrToolsOptimizeUrl,
  HEALTH_TIMEOUT_MS,
  mapOrToolsConnectionError,
} from './ortools-config'

const originalEnv = process.env.ORTOOLS_SERVICE_URL

beforeEach(() => {
  delete process.env.ORTOOLS_SERVICE_URL
})

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.ORTOOLS_SERVICE_URL
  } else {
    process.env.ORTOOLS_SERVICE_URL = originalEnv
  }
})

describe('getOrToolsOptimizeUrl', () => {
  it('returns default when env is unset', () => {
    expect(getOrToolsOptimizeUrl(undefined)).toBe(DEFAULT_ORTOOLS_OPTIMIZE_URL)
  })

  it('normalizes explicit optimize-route URL', () => {
    expect(getOrToolsOptimizeUrl('http://127.0.0.1:8000/optimize-route')).toBe(
      'http://127.0.0.1:8000/optimize-route'
    )
  })

  it('falls back on malformed URL', () => {
    expect(getOrToolsOptimizeUrl('not-a-url')).toBe(DEFAULT_ORTOOLS_OPTIMIZE_URL)
  })

  it('converts health URL to optimize-route URL', () => {
    expect(getOrToolsOptimizeUrl('http://127.0.0.1:8000/health')).toBe(
      'http://127.0.0.1:8000/optimize-route'
    )
  })
})

describe('getOrToolsHealthUrl', () => {
  const cases: Array<{ input: string; expected: string }> = [
    {
      input: 'http://127.0.0.1:8000/optimize-route',
      expected: 'http://127.0.0.1:8000/health',
    },
    {
      input: 'http://127.0.0.1:8000/optimize-route/',
      expected: 'http://127.0.0.1:8000/health',
    },
    {
      input: 'http://127.0.0.1:8000/health',
      expected: 'http://127.0.0.1:8000/health',
    },
    {
      input: 'http://127.0.0.1:8000',
      expected: 'http://127.0.0.1:8000/health',
    },
    {
      input: 'http://127.0.0.1:8000/',
      expected: 'http://127.0.0.1:8000/health',
    },
    {
      input: 'http://custom:9000/api/optimize-route',
      expected: 'http://custom:9000/api/health',
    },
  ]

  it.each(cases)('derives $expected from $input', ({ input, expected }) => {
    expect(getOrToolsHealthUrl(input)).toBe(expected)
  })

  it('falls back on malformed URL', () => {
    expect(getOrToolsHealthUrl('::::')).toBe(DEFAULT_ORTOOLS_HEALTH_URL)
  })
})

describe('formatHealthTimeoutMessage', () => {
  it('derives seconds from HEALTH_TIMEOUT_MS', () => {
    expect(formatHealthTimeoutMessage(HEALTH_TIMEOUT_MS)).toBe('Health check timed out (5s)')
  })
})

describe('mapOrToolsConnectionError', () => {
  it('maps AbortError to timeout message', () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    expect(mapOrToolsConnectionError(err)).toBe(
      'Health check timed out (5s)'
    )
  })

  it('maps ECONNREFUSED to user-friendly message', () => {
    const err = Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' })
    expect(mapOrToolsConnectionError(err)).toBe(
      'OR-Tools service unreachable — check that the service is running'
    )
  })

  it('maps unknown errors to generic unreachable message', () => {
    expect(mapOrToolsConnectionError(new Error('something weird'))).toBe(
      'OR-Tools service unreachable'
    )
  })
})