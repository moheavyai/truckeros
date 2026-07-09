import { readFileSync } from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

vi.mock('@/lib/dev-mode', () => ({
  isDevAccountSwitcherEnabled: vi.fn(() => true),
  isDevBaseOwnerSwitchAllowed: vi.fn(() => true),
  DEV_BASE_OWNER_EMAIL: 'andrehampton1@outlook.com',
}))

vi.mock('@/lib/dev-account-switch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dev-account-switch')>()
  return {
    ...actual,
    fetchDevSwitchAllowlistEmails: vi.fn(),
  }
})

vi.mock('@/lib/team-member-profiles-api', () => ({
  createAuthedSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  hasAdminAccess: true,
  supabaseAdmin: {
    auth: {
      admin: {
        generateLink: vi.fn(),
      },
    },
  },
}))

describe('/api/dev/switch-user', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    const { isDevAccountSwitcherEnabled } = await import('@/lib/dev-mode')
    vi.mocked(isDevAccountSwitcherEnabled).mockReturnValue(true)
  })

  it('avoids getAuthenticatedMemberProfile and uses createAuthedSupabaseClient', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'app', 'api', 'dev', 'switch-user', 'route.ts'),
      'utf8'
    )

    expect(source).toContain('createAuthedSupabaseClient')
    expect(source).not.toContain('getAuthenticatedMemberProfile')
  })

  it('returns 404 when dev switcher is disabled', async () => {
    const { isDevAccountSwitcherEnabled } = await import('@/lib/dev-mode')
    vi.mocked(isDevAccountSwitcherEnabled).mockReturnValue(false)

    const response = await POST(
      new NextRequest('http://localhost/api/dev/switch-user', {
        method: 'POST',
        body: JSON.stringify({ email: 'driver@example.com' }),
      })
    )

    expect(response.status).toBe(404)
  })

  it('returns 401 without bearer token', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/dev/switch-user', {
        method: 'POST',
        body: JSON.stringify({ email: 'driver@example.com' }),
      })
    )

    expect(response.status).toBe(401)
  })

  it('returns 401 when getUser fails', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'invalid JWT' },
        }),
      },
    } as never)

    const response = await POST(
      new NextRequest('http://localhost/api/dev/switch-user', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer bad-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'driver@example.com' }),
      })
    )

    expect(response.status).toBe(401)
  })

  it('returns 400 for malformed JSON', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'driver-1', email: 'driver@example.com' } },
          error: null,
        }),
      },
    } as never)

    const response = await POST(
      new NextRequest('http://localhost/api/dev/switch-user', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: '{not-json',
      })
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid JSON body')
  })

  it('returns 403 for emails outside the allowlist', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')
    const { fetchDevSwitchAllowlistEmails } = await import('@/lib/dev-account-switch')

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'driver-1', email: 'driver@example.com' } },
          error: null,
        }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { organization_id: 'org-1' }, error: null })),
          })),
        })),
      })),
    } as never)
    vi.mocked(fetchDevSwitchAllowlistEmails).mockResolvedValue(
      new Set(['andrehampton1@outlook.com', 'driver@example.com'])
    )

    const response = await POST(
      new NextRequest('http://localhost/api/dev/switch-user', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'stranger@example.com' }),
      })
    )

    expect(response.status).toBe(403)
  })

  it('returns hashed_token for allowlisted email', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')
    const { fetchDevSwitchAllowlistEmails } = await import('@/lib/dev-account-switch')
    const { supabaseAdmin } = await import('@/lib/supabase')

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'owner-1', email: 'owner@example.com' } },
          error: null,
        }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { organization_id: 'org-1' }, error: null })),
          })),
        })),
      })),
    } as never)
    vi.mocked(fetchDevSwitchAllowlistEmails).mockResolvedValue(
      new Set(['andrehampton1@outlook.com', 'driver@example.com'])
    )
    vi.mocked(supabaseAdmin!.auth.admin.generateLink).mockResolvedValue({
      data: {
        properties: { hashed_token: 'hashed-token-driver' },
      },
      error: null,
    } as never)

    const response = await POST(
      new NextRequest('http://localhost/api/dev/switch-user', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'driver@example.com' }),
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.data.hashed_token).toBe('hashed-token-driver')
    expect(body.data.email).toBe('driver@example.com')
  })

  it('allows owner switch via fast-path when allowlist omits owner email', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')
    const { fetchDevSwitchAllowlistEmails } = await import('@/lib/dev-account-switch')
    const { supabaseAdmin } = await import('@/lib/supabase')

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'driver-1', email: 'driver@example.com' } },
          error: null,
        }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { organization_id: 'org-1' }, error: null })),
          })),
        })),
      })),
    } as never)
    vi.mocked(fetchDevSwitchAllowlistEmails).mockResolvedValue(new Set(['driver@example.com']))
    vi.mocked(supabaseAdmin!.auth.admin.generateLink).mockResolvedValue({
      data: {
        properties: { hashed_token: 'hashed-token-owner' },
      },
      error: null,
    } as never)

    const response = await POST(
      new NextRequest('http://localhost/api/dev/switch-user', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'andrehampton1@outlook.com' }),
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.email).toBe('andrehampton1@outlook.com')
    expect(supabaseAdmin!.auth.admin.generateLink).toHaveBeenCalled()
  })

  it('allows roster-only actor to switch when org resolves from team_member_profiles', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')
    const { fetchDevSwitchAllowlistEmails } = await import('@/lib/dev-account-switch')
    const { supabaseAdmin } = await import('@/lib/supabase')

    const mockFrom = vi.fn((table: string) => {
      if (table === 'member_profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        }
      }
      if (table === 'team_member_profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((column: string) => {
              if (column === 'linked_user_id') {
                return {
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({
                        data: { organization_id: 'org-roster' },
                        error: null,
                      })),
                    })),
                  })),
                }
              }
              return {
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
                  })),
                })),
              }
            }),
          })),
        }
      }
      return {}
    })

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'roster-1', email: 'roster@example.com' } },
          error: null,
        }),
      },
      from: mockFrom,
    } as never)

    vi.mocked(fetchDevSwitchAllowlistEmails).mockResolvedValue(
      new Set(['andrehampton1@outlook.com', 'roster@example.com'])
    )
    vi.mocked(supabaseAdmin!.auth.admin.generateLink).mockResolvedValue({
      data: {
        properties: { hashed_token: 'hashed-token-roster' },
      },
      error: null,
    } as never)

    const response = await POST(
      new NextRequest('http://localhost/api/dev/switch-user', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'andrehampton1@outlook.com' }),
      })
    )

    expect(response.status).toBe(200)
    expect(fetchDevSwitchAllowlistEmails).toHaveBeenCalledWith(
      expect.anything(),
      'org-roster',
      'roster@example.com',
      expect.objectContaining({ adminClient: expect.anything() })
    )
  })

  it('rejects non-localhost redirect without NEXT_PUBLIC_APP_URL', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL

    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')
    const { fetchDevSwitchAllowlistEmails } = await import('@/lib/dev-account-switch')
    const { supabaseAdmin } = await import('@/lib/supabase')

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'driver-1', email: 'driver@example.com' } },
          error: null,
        }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { organization_id: 'org-1' }, error: null })),
          })),
        })),
      })),
    } as never)
    vi.mocked(fetchDevSwitchAllowlistEmails).mockResolvedValue(new Set(['driver@example.com']))

    const response = await POST(
      new NextRequest('http://localhost/api/dev/switch-user', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
          'x-forwarded-host': 'evil.example.com',
        },
        body: JSON.stringify({ email: 'driver@example.com' }),
      })
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toContain('NEXT_PUBLIC_APP_URL')
    expect(supabaseAdmin!.auth.admin.generateLink).not.toHaveBeenCalled()
  })

  it('returns generic 500 when generateLink omits hashed_token', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')
    const { fetchDevSwitchAllowlistEmails } = await import('@/lib/dev-account-switch')
    const { supabaseAdmin } = await import('@/lib/supabase')

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'driver-1', email: 'driver@example.com' } },
          error: null,
        }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { organization_id: 'org-1' }, error: null })),
          })),
        })),
      })),
    } as never)
    vi.mocked(fetchDevSwitchAllowlistEmails).mockResolvedValue(new Set(['driver@example.com']))
    vi.mocked(supabaseAdmin!.auth.admin.generateLink).mockResolvedValue({
      data: {
        properties: { action_link: 'https://auth.example.com/magic' },
      },
      error: null,
    } as never)

    const response = await POST(
      new NextRequest('http://localhost/api/dev/switch-user', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'driver@example.com' }),
      })
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Failed to switch user')
    expect(body.data?.hashed_token).toBeUndefined()
  })

  it('returns generic 500 when generateLink fails', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')
    const { fetchDevSwitchAllowlistEmails } = await import('@/lib/dev-account-switch')
    const { supabaseAdmin } = await import('@/lib/supabase')

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'driver-1', email: 'driver@example.com' } },
          error: null,
        }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { organization_id: 'org-1' }, error: null })),
          })),
        })),
      })),
    } as never)
    vi.mocked(fetchDevSwitchAllowlistEmails).mockResolvedValue(new Set(['driver@example.com']))
    vi.mocked(supabaseAdmin!.auth.admin.generateLink).mockResolvedValue({
      data: null,
      error: { message: 'internal supabase failure' },
    } as never)

    const response = await POST(
      new NextRequest('http://localhost/api/dev/switch-user', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'driver@example.com' }),
      })
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Failed to switch user')
    expect(body.error).not.toContain('internal supabase failure')
  })
})