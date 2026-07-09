import { describe, expect, it } from 'vitest'
import { isSameOriginPostRequest } from './same-origin-request'

function makeRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/admin/migrate', {
    method: 'POST',
    headers,
  })
}

describe('isSameOriginPostRequest', () => {
  it('rejects when Host header is missing', () => {
    expect(isSameOriginPostRequest(makeRequest({}))).toBe(false)
  })

  it('allows same-origin Origin matching Host', () => {
    expect(
      isSameOriginPostRequest(
        makeRequest({ host: 'localhost:3000', origin: 'http://localhost:3000' })
      )
    ).toBe(true)
  })

  it('rejects cross-origin Origin', () => {
    expect(
      isSameOriginPostRequest(
        makeRequest({ host: 'localhost:3000', origin: 'https://evil.example.com' })
      )
    ).toBe(false)
  })

  it('rejects invalid Origin URL', () => {
    expect(
      isSameOriginPostRequest(makeRequest({ host: 'localhost', origin: 'not a url' }))
    ).toBe(false)
  })

  it('allows matching Referer when Origin is absent', () => {
    expect(
      isSameOriginPostRequest(
        makeRequest({
          host: 'app.example.com',
          referer: 'https://app.example.com/admin',
        })
      )
    ).toBe(true)
  })

  it('rejects mismatched Referer when Origin is absent', () => {
    expect(
      isSameOriginPostRequest(
        makeRequest({
          host: 'app.example.com',
          referer: 'https://evil.example.com/admin',
        })
      )
    ).toBe(false)
  })

  it('rejects invalid Referer URL when Origin is absent', () => {
    expect(
      isSameOriginPostRequest(makeRequest({ host: 'localhost', referer: '://bad' }))
    ).toBe(false)
  })

  it('allows non-browser clients that omit Origin and Referer', () => {
    expect(isSameOriginPostRequest(makeRequest({ host: 'localhost' }))).toBe(true)
  })

  it('prefers Origin over Referer when both are present', () => {
    expect(
      isSameOriginPostRequest(
        makeRequest({
          host: 'localhost',
          origin: 'https://evil.example.com',
          referer: 'http://localhost/',
        })
      )
    ).toBe(false)
  })
})
