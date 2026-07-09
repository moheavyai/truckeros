import { describe, expect, it } from 'vitest'
import { isSafeLocalDevHost } from './safe-local-dev-host'

describe('isSafeLocalDevHost', () => {
  it('allows exact local hosts with optional port', () => {
    expect(isSafeLocalDevHost('localhost')).toBe(true)
    expect(isSafeLocalDevHost('localhost:3000')).toBe(true)
    expect(isSafeLocalDevHost('127.0.0.1')).toBe(true)
    expect(isSafeLocalDevHost('127.0.0.1:3000')).toBe(true)
    expect(isSafeLocalDevHost('[::1]')).toBe(true)
    expect(isSafeLocalDevHost('[::1]:3000')).toBe(true)
  })

  it('rejects empty / whitespace host', () => {
    expect(isSafeLocalDevHost('')).toBe(false)
    expect(isSafeLocalDevHost('   ')).toBe(false)
  })

  it('rejects localhost.evil.com and similar prefix tricks', () => {
    expect(isSafeLocalDevHost('localhost.evil.com')).toBe(false)
    expect(isSafeLocalDevHost('127.0.0.1.nip.io')).toBe(false)
    expect(isSafeLocalDevHost('evil.com')).toBe(false)
  })

  it('rejects userinfo / @ authority tricks', () => {
    expect(isSafeLocalDevHost('127.0.0.1:80@evil.com')).toBe(false)
    expect(isSafeLocalDevHost('localhost:3000@evil.com')).toBe(false)
    expect(isSafeLocalDevHost('user@localhost')).toBe(false)
  })
})
