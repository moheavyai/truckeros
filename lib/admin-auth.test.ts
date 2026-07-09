import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}))

import { isAdminUser, parseAdminEmails, requireAdminUser } from './admin-auth'

describe('parseAdminEmails', () => {
  const original = process.env.ADMIN_EMAILS

  afterEach(() => {
    process.env.ADMIN_EMAILS = original
  })

  it('parses comma-separated emails case-insensitively', () => {
    process.env.ADMIN_EMAILS = ' Admin@Example.com , user@test.com '
    expect(parseAdminEmails()).toEqual(['admin@example.com', 'user@test.com'])
  })

  it('returns empty array when ADMIN_EMAILS is unset', () => {
    delete process.env.ADMIN_EMAILS
    expect(parseAdminEmails()).toEqual([])
  })
})

describe('isAdminUser', () => {
  const original = process.env.ADMIN_EMAILS

  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'admin@example.com'
  })

  afterEach(() => {
    process.env.ADMIN_EMAILS = original
  })

  it('allows users with app_metadata.role admin', () => {
    expect(
      isAdminUser({
        id: '1',
        email: 'anyone@example.com',
        app_metadata: { role: 'admin' },
      } as any)
    ).toBe(true)
  })

  it('allows users whose email is in ADMIN_EMAILS', () => {
    expect(
      isAdminUser({
        id: '1',
        email: 'Admin@Example.com',
        app_metadata: {},
      } as any)
    ).toBe(true)
  })

  it('rejects non-admin users without matching email', () => {
    expect(
      isAdminUser({
        id: '1',
        email: 'user@example.com',
        app_metadata: {},
      } as any)
    ).toBe(false)
  })
})

describe('requireAdminUser', () => {
  const original = process.env.ADMIN_EMAILS

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_EMAILS = 'admin@example.com'
  })

  afterEach(() => {
    process.env.ADMIN_EMAILS = original
  })

  it('returns 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const result = await requireAdminUser()

    expect('response' in result).toBe(true)
    if ('response' in result) {
      expect(result.response.status).toBe(401)
      const body = await result.response.json()
      expect(body.error).toBe('Unauthorized')
    }
  })

  it('returns 403 when user is not an admin', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'user@example.com', app_metadata: {} } },
    })

    const result = await requireAdminUser()

    expect('response' in result).toBe(true)
    if ('response' in result) {
      expect(result.response.status).toBe(403)
      const body = await result.response.json()
      expect(body.error).toBe('Forbidden')
    }
  })

  it('returns user when admin via email allowlist', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'a1', email: 'admin@example.com', app_metadata: {} } },
    })

    const result = await requireAdminUser()

    expect('user' in result).toBe(true)
    if ('user' in result) {
      expect(result.user.email).toBe('admin@example.com')
    }
  })

  it('returns user when admin via app_metadata.role', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: { id: 'a2', email: 'other@example.com', app_metadata: { role: 'admin' } },
      },
    })

    const result = await requireAdminUser()

    expect('user' in result).toBe(true)
    if ('user' in result) {
      expect(result.user.app_metadata?.role).toBe('admin')
    }
  })
})