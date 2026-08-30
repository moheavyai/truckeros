import { describe, expect, it } from 'vitest'
import {
  EMAIL_VERIFY_COOLDOWN_MS,
  emailVerifyCooldownRemainingMs,
  isEmailVerified,
  isEmailVerifyCooldownActive,
} from './email-verification'
import { generateEmailToken, hashEmailToken } from './email-verification-crypto'

describe('isEmailVerified', () => {
  it('is true when verified_at is a timestamp', () => {
    expect(isEmailVerified({ verified_at: '2026-08-20T12:00:00.000Z' })).toBe(true)
  })

  it('is false for null, empty, or missing rows', () => {
    expect(isEmailVerified(null)).toBe(false)
    expect(isEmailVerified(undefined)).toBe(false)
    expect(isEmailVerified({ verified_at: null })).toBe(false)
    expect(isEmailVerified({ verified_at: '' })).toBe(false)
    expect(isEmailVerified({})).toBe(false)
  })
})

describe('hashEmailToken', () => {
  it('is stable for the same input', () => {
    const a = hashEmailToken('inbox-proof-token')
    const b = hashEmailToken('inbox-proof-token')
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes when the input changes', () => {
    expect(hashEmailToken('token-a')).not.toBe(hashEmailToken('token-b'))
  })
})

describe('generateEmailToken', () => {
  it('returns a non-empty base64url token', () => {
    const token = generateEmailToken()
    expect(token.length).toBeGreaterThan(20)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('email verify cooldown math', () => {
  const lastSent = '2026-08-20T12:00:00.000Z'
  const sentMs = Date.parse(lastSent)

  it('is active until 60s have elapsed', () => {
    expect(isEmailVerifyCooldownActive(lastSent, sentMs + 1_000)).toBe(true)
    expect(isEmailVerifyCooldownActive(lastSent, sentMs + EMAIL_VERIFY_COOLDOWN_MS - 1)).toBe(true)
    expect(isEmailVerifyCooldownActive(lastSent, sentMs + EMAIL_VERIFY_COOLDOWN_MS)).toBe(false)
  })

  it('is inactive when last_sent_at is missing', () => {
    expect(isEmailVerifyCooldownActive(null, sentMs)).toBe(false)
    expect(isEmailVerifyCooldownActive(undefined, sentMs)).toBe(false)
  })

  it('reports remaining milliseconds until cooldown ends', () => {
    expect(emailVerifyCooldownRemainingMs(lastSent, sentMs + 15_000)).toBe(45_000)
    expect(emailVerifyCooldownRemainingMs(lastSent, sentMs + EMAIL_VERIFY_COOLDOWN_MS + 5_000)).toBe(
      0
    )
  })
})
