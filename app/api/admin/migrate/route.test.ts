import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFrom = vi.fn()
const mockGetDatabaseConnectionString = vi.fn()
const mockRunMigrationSql = vi.fn()
const mockGetUser = vi.fn()
const mockFetchMembershipRoleCheckStatus = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}))

vi.mock('@/lib/db-migrate', () => ({
  getDatabaseConnectionString: () => mockGetDatabaseConnectionString(),
  runMigrationSql: (...args: unknown[]) => mockRunMigrationSql(...args),
}))

vi.mock('@/lib/admin-migrate-role-check', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin-migrate-role-check')>()
  return {
    ...actual,
    fetchMembershipRoleCheckStatus: (...args: unknown[]) =>
      mockFetchMembershipRoleCheckStatus(...args),
  }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}))

import { GET, POST } from './route'

const ROLE_CHECK_OK_DEF =
  "CHECK (role = ANY (ARRAY['Owner'::text, 'Admin'::text, 'Driver'::text, 'Permit Clerk'::text, 'Viewer'::text]))"
const ROLE_CHECK_LEGACY_DEF =
  "CHECK (role = ANY (ARRAY['Owner / Admin'::text, 'Driver'::text, 'Permit Clerk'::text, 'Viewer'::text]))"

function makePostRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/admin/migrate', {
    method: 'POST',
    headers: {
      host: 'localhost',
      ...headers,
    },
  })
}

function mockSchemaComplete() {
  mockFrom.mockImplementation(() => ({
    select: () => ({
      limit: async () => ({ error: null }),
    }),
  }))
}

function mockAdminUser(email = 'admin@example.com') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'admin-1', email, app_metadata: {} } },
  })
}

describe('GET /api/admin/migrate', () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_EMAILS = 'admin@example.com'
    mockAdminUser()
    mockFetchMembershipRoleCheckStatus.mockResolvedValue({
      checked: true,
      ok: true,
      def: ROLE_CHECK_OK_DEF,
    })
  })

  afterEach(() => {
    process.env.ADMIN_EMAILS = originalAdminEmails
  })

  it('returns 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns 403 when user is not in ADMIN_EMAILS', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'user@example.com', app_metadata: {} } },
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('Forbidden')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('reports all required rig builder columns when schema is complete', async () => {
    mockSchemaComplete()

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.columnsExist).toBe(true)
    expect(body.needsMigration).toBe(false)
    expect(body.missingColumns).toEqual([])
    expect(body.migration017Sql).toContain('tractors')
    expect(body.migration017Sql).toContain('trailers')
    expect(body.requiredColumns).toEqual(
      expect.arrayContaining([
        'permit_requests.origin_query',
        'permit_requests.destination_query',
        'permit_requests.drops',
        'equipment_profiles.license_plate',
        'equipment_profiles.license_plate_state',
        'rig_configurations.is_default',
        'team_member_profiles.permissions',
        'team_invites.organization_id',
        'team_invites.invite_token',
        'team_invites.status',
        'profile_change_requests.id',
        'profile_change_requests.organization_id',
        'profile_change_requests.requester_user_id',
        'profile_change_requests.target_user_id',
        'profile_change_requests.field_key',
        'profile_change_requests.status',
        'carrier_connection_invites.invite_token',
        'carrier_connection_invites.status',
        'carrier_connection_invites.company_name',
        'carrier_connection_invites.organization_id',
        'carrier_connection_invites.invite_email',
      ])
    )
    expect(body.migration022Sql).toContain('profile_change_requests')
    expect(body.migration022Sql).toContain(
      'CREATE TABLE IF NOT EXISTS profile_change_requests'
    )
    expect(body.migration023Sql).toContain(
      'Users can delete own pending profile change requests'
    )
    expect(body.migration031Sql).toContain('team_member_profiles')
    expect(body.migration031Sql).toContain('permissions jsonb')
    expect(body.migration033Sql).toContain('team_invites')
    expect(body.migration033Sql).toContain('CREATE TABLE IF NOT EXISTS team_invites')
    expect(body.migration035Sql).toContain('carrier_connection_invites')
    expect(body.migration035Sql).toContain(
      'CREATE TABLE IF NOT EXISTS carrier_connection_invites'
    )
    expect(body.migration035Sql).toContain("NOTIFY pgrst, 'reload schema'")
    expect(body.migration036Sql).toContain('organization_memberships_role_check')
    expect(body.migration037Sql).toContain('auth_user_equipment_membership_org_ids')
    expect(body.migration037Sql).toContain("role = 'Permit Clerk'")
    expect(body.migration038Sql).toContain('enforce_no_self_promote_to_permit_clerk')
    expect(body.migration038Sql).toContain("om.role = 'Permit Clerk'")
    expect(body.migration039Sql).toContain('trg_no_self_promote_to_permit_clerk_insert')
    expect(body.migration039Sql).toContain('truckeros.team_invite_accept')
    expect(body.migration040Sql).toContain('trg_no_self_permit_clerk_team_invite_update')
    expect(body.migration040Sql).toContain('BEFORE UPDATE ON team_invites')
    expect(body.migration041Sql).toContain('independent of invited_by')
    expect(body.migration041Sql).toContain('session user')
    expect(body.membershipRoleCheckOk).toBe(true)
  })

  it('flags legacy organization_memberships role CHECK as needsMigration', async () => {
    mockSchemaComplete()
    mockFetchMembershipRoleCheckStatus.mockResolvedValue({
      checked: true,
      ok: false,
      def: ROLE_CHECK_LEGACY_DEF,
    })

    const res = await GET()
    const body = await res.json()

    expect(body.columnsExist).toBe(false)
    expect(body.needsMigration).toBe(true)
    expect(body.membershipRoleCheckOk).toBe(false)
    expect(body.missingColumns).toContain('organization_memberships.role_check')
    expect(body.error).toMatch(/role CHECK/i)
  })

  it('flags missing team_invites table', async () => {
    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'team_invites') {
            return {
              error: { message: 'relation "team_invites" does not exist' },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await GET()
    const body = await res.json()

    expect(body.columnsExist).toBe(false)
    expect(body.needsMigration).toBe(true)
    expect(body.missingColumns).toEqual(
      expect.arrayContaining([
        'team_invites.organization_id',
        'team_invites.invite_token',
        'team_invites.status',
      ])
    )
  })

  it('flags missing carrier_connection_invites table', async () => {
    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'carrier_connection_invites') {
            return {
              error: { message: 'relation "carrier_connection_invites" does not exist' },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await GET()
    const body = await res.json()

    expect(body.columnsExist).toBe(false)
    expect(body.needsMigration).toBe(true)
    expect(body.missingColumns).toEqual(
      expect.arrayContaining([
        'carrier_connection_invites.invite_token',
        'carrier_connection_invites.status',
        'carrier_connection_invites.company_name',
        'carrier_connection_invites.organization_id',
        'carrier_connection_invites.invite_email',
      ])
    )
  })

  it('flags missing profile_change_requests table', async () => {
    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'profile_change_requests') {
            return {
              error: { message: 'relation "profile_change_requests" does not exist' },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await GET()
    const body = await res.json()

    expect(body.columnsExist).toBe(false)
    expect(body.needsMigration).toBe(true)
    expect(body.missingColumns).toEqual(
      expect.arrayContaining([
        'profile_change_requests.id',
        'profile_change_requests.organization_id',
        'profile_change_requests.requester_user_id',
        'profile_change_requests.target_user_id',
        'profile_change_requests.field_key',
        'profile_change_requests.status',
      ])
    )
  })

  it('reports inconclusive carrier_connection_invites check with needsMigration true', async () => {
    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'carrier_connection_invites') {
            return {
              error: { message: 'permission denied for table carrier_connection_invites' },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await GET()
    const body = await res.json()

    expect(body.columnsExist).toBe(false)
    expect(body.needsMigration).toBe(true)
    expect(body.inconclusiveChecks).toEqual(['carrier_connection_invites'])
    expect(body.missingColumns).not.toContain('carrier_connection_invites.invite_token')
  })

  it('reports inconclusive profile_change_requests check with needsMigration true', async () => {
    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'profile_change_requests') {
            return {
              error: { message: 'permission denied for table profile_change_requests' },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await GET()
    const body = await res.json()

    expect(body.columnsExist).toBe(false)
    expect(body.needsMigration).toBe(true)
    expect(body.inconclusiveChecks).toEqual(['profile_change_requests'])
    expect(body.missingColumns).not.toContain('profile_change_requests.id')
  })

  it('flags missing team_member_profiles permissions column', async () => {
    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'team_member_profiles') {
            return {
              error: {
                message: "Could not find the 'permissions' column of 'team_member_profiles' in the schema cache",
              },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await GET()
    const body = await res.json()

    expect(body.columnsExist).toBe(false)
    expect(body.needsMigration).toBe(true)
    expect(body.missingColumns).toEqual(
      expect.arrayContaining(['team_member_profiles.permissions'])
    )
  })

  it('flags missing equipment_profiles license plate columns', async () => {
    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'equipment_profiles') {
            return { error: { message: 'column equipment_profiles.license_plate does not exist' } }
          }
          return { error: null }
        },
      }),
    }))

    const res = await GET()
    const body = await res.json()

    expect(body.columnsExist).toBe(false)
    expect(body.needsMigration).toBe(true)
    expect(body.missingColumns).toEqual(
      expect.arrayContaining(['equipment_profiles.license_plate'])
    )
  })

  it('allows GET when user has app_metadata.role admin', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: { id: 'a2', email: 'other@example.com', app_metadata: { role: 'admin' } },
      },
    })
    mockSchemaComplete()

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.columnsExist).toBe(true)
  })

  it('reports inconclusive team_invites check with needsMigration true', async () => {
    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'team_invites') {
            return { error: { message: 'permission denied for table team_invites' } }
          }
          return { error: null }
        },
      }),
    }))

    const res = await GET()
    const body = await res.json()

    expect(body.columnsExist).toBe(false)
    expect(body.needsMigration).toBe(true)
    expect(body.inconclusiveChecks).toEqual(['team_invites'])
    expect(body.missingColumns).not.toContain('team_invites.organization_id')
  })

  it('reports inconclusive team_member_profiles check with needsMigration true', async () => {
    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'team_member_profiles') {
            return { error: { message: 'permission denied for table team_member_profiles' } }
          }
          return { error: null }
        },
      }),
    }))

    const res = await GET()
    const body = await res.json()

    expect(body.columnsExist).toBe(false)
    expect(body.needsMigration).toBe(true)
    expect(body.inconclusiveChecks).toEqual(['team_member_profiles'])
    expect(body.missingColumns).not.toContain('team_member_profiles.permissions')
  })

  it('flags missing rig_configurations table as needsMigration', async () => {
    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'rig_configurations') {
            return { error: { message: 'relation "rig_configurations" does not exist' } }
          }
          return { error: null }
        },
      }),
    }))

    const res = await GET()
    const body = await res.json()

    expect(body.columnsExist).toBe(false)
    expect(body.needsMigration).toBe(true)
    expect(body.missingColumns).toEqual(
      expect.arrayContaining(['rig_configurations.is_default'])
    )
  })
})

describe('POST /api/admin/migrate', () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS
  const originalNodeEnv = process.env.NODE_ENV
  const originalMigrateAllow = process.env.MIGRATE_ALLOW_LIVE_IN_PRODUCTION

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_EMAILS = 'admin@example.com'
    process.env.NODE_ENV = 'development'
    delete process.env.MIGRATE_ALLOW_LIVE_IN_PRODUCTION
    mockAdminUser()
    mockGetDatabaseConnectionString.mockReturnValue(null)
    mockRunMigrationSql.mockReset()
    mockFetchMembershipRoleCheckStatus.mockResolvedValue({
      checked: true,
      ok: true,
      def: ROLE_CHECK_OK_DEF,
    })
  })

  afterEach(() => {
    process.env.ADMIN_EMAILS = originalAdminEmails
    process.env.NODE_ENV = originalNodeEnv
    if (originalMigrateAllow === undefined) {
      delete process.env.MIGRATE_ALLOW_LIVE_IN_PRODUCTION
    } else {
      process.env.MIGRATE_ALLOW_LIVE_IN_PRODUCTION = originalMigrateAllow
    }
  })

  it('returns 403 for cross-origin POST', async () => {
    const res = await POST(
      makePostRequest({ origin: 'https://evil.example.com' })
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('Forbidden')
    expect(mockRunMigrationSql).not.toHaveBeenCalled()
  })

  it('returns 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(mockRunMigrationSql).not.toHaveBeenCalled()
  })

  it('returns 403 when user is not admin', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'user@example.com', app_metadata: {} } },
    })

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('Forbidden')
    expect(mockRunMigrationSql).not.toHaveBeenCalled()
  })

  it('allows POST when user has app_metadata.role admin', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: { id: 'a2', email: 'other@example.com', app_metadata: { role: 'admin' } },
      },
    })

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.needsManualRun).toBe(true)
    expect(mockRunMigrationSql).not.toHaveBeenCalled()
  })

  it('returns 403 for live apply in production without override', async () => {
    process.env.NODE_ENV = 'production'
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.needsManualRun).toBe(true)
    expect(body.applied).toBe(false)
    expect(mockRunMigrationSql).not.toHaveBeenCalled()
  })

  it('returns consolidated SQL including rig builder migration 017 when no DB connection', async () => {
    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(body.needsManualRun).toBe(true)
    expect(body.sql).toContain('rig_configurations')
    expect(body.sql).toContain('is_default')
    expect(body.sql).toContain('equipment_profiles')
    expect(body.sql).toContain('license_plate')
    expect(body.sql).toContain('tractors')
    expect(body.sql).toContain('trailers')
    expect(body.migration017Sql).toContain("NOTIFY pgrst, 'reload schema'")
    expect(mockRunMigrationSql).not.toHaveBeenCalled()
  })

  it('applies migration SQL when DATABASE_URL is configured', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')
    mockRunMigrationSql.mockResolvedValue(undefined)
    mockSchemaComplete()

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(mockRunMigrationSql).toHaveBeenCalledTimes(1)
    const sqlArg = mockRunMigrationSql.mock.calls[0][0] as string
    expect(sqlArg).toEqual(expect.stringContaining('license_plate'))
    expect(sqlArg).toEqual(expect.stringContaining('is_default'))
    expect(sqlArg).toEqual(expect.stringContaining("NOTIFY pgrst, 'reload schema'"))
    expect(body.applied).toBe(true)
    expect(body.success).toBe(true)
    expect(body.columnsExist).toBe(true)
  })

  it('logs warning when applying live migration in production with override', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.NODE_ENV = 'production'
    process.env.MIGRATE_ALLOW_LIVE_IN_PRODUCTION = 'true'
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')
    mockRunMigrationSql.mockResolvedValue(undefined)
    mockSchemaComplete()

    await POST(makePostRequest())

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('MIGRATE_ALLOW_LIVE_IN_PRODUCTION=true')
    )
    warnSpy.mockRestore()
  })

  it('returns needsManualRun when runMigrationSql throws', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')
    mockRunMigrationSql.mockRejectedValue(new Error('connection refused'))
    mockSchemaComplete()

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(body.applied).toBe(false)
    expect(body.needsManualRun).toBe(true)
    expect(body.success).toBe(false)
    expect(body.error).toBe('Migration operation failed. Check server logs for details.')
    expect(body.correlationId).toBeTruthy()
  })

  it('applies migration 031 when permissions column remains missing after full migration', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    let permissionsMissing = true
    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      const isTargeted031Only =
        sql.includes('Repair migration: ensure team_member_profiles.permissions') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted031Only) {
        permissionsMissing = false
      }
    })

    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'team_member_profiles' && permissionsMissing) {
            return {
              error: {
                message:
                  "Could not find the 'permissions' column of 'team_member_profiles' in the schema cache",
              },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(mockRunMigrationSql).toHaveBeenCalledTimes(2)
    expect(mockRunMigrationSql.mock.calls[1][0]).toContain('permissions jsonb')
    expect(body.permissionsMigrationAttempted).toBe(true)
    expect(body.permissionsMigrationApplied).toBe(true)
    expect(body.columnsExist).toBe(true)
  })

  it('attempts migration 031 when team_member_profiles schema check is inconclusive', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    let permissionsResolved = false
    let teamMemberChecks = 0
    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      const isTargeted031Only =
        sql.includes('Repair migration: ensure team_member_profiles.permissions') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted031Only) {
        permissionsResolved = true
      }
    })

    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'team_member_profiles') {
            teamMemberChecks += 1
            if (!permissionsResolved) {
              return { error: { message: 'permission denied for table team_member_profiles' } }
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(mockRunMigrationSql).toHaveBeenCalledTimes(2)
    expect(body.permissionsMigrationAttempted).toBe(true)
    expect(body.permissionsMigrationApplied).toBe(true)
    expect(body.inconclusiveChecks ?? []).not.toContain('team_member_profiles')
  })

  it('recovers via migration 031 when full migration throws', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    let permissionsMissing = true
    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      const isTargeted031Only =
        sql.includes('Repair migration: ensure team_member_profiles.permissions') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted031Only) {
        permissionsMissing = false
        return
      }
      throw new Error('member_profiles_user_roles_check violated')
    })

    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'team_member_profiles' && permissionsMissing) {
            return {
              error: {
                message:
                  "Could not find the 'permissions' column of 'team_member_profiles' in the schema cache",
              },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(mockRunMigrationSql).toHaveBeenCalledTimes(2)
    expect(body.permissionsMigrationAttempted).toBe(true)
    expect(body.permissionsMigrationApplied).toBe(true)
    expect(body.applied).toBe(true)
    expect(body.needsManualRun).toBe(true)
    expect(body.error).toBe('Migration operation failed. Check server logs for details.')
  })

  it('applies migration 033 when team_invites remains missing after full migration', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    let teamInvitesMissing = true
    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      const isTargeted033Only =
        sql.includes('Repair migration: ensure team_invites table exists') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted033Only) {
        teamInvitesMissing = false
      }
    })

    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'team_invites' && teamInvitesMissing) {
            return {
              error: { message: 'relation "team_invites" does not exist' },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(mockRunMigrationSql).toHaveBeenCalledTimes(2)
    expect(mockRunMigrationSql.mock.calls[1][0]).toContain('CREATE TABLE IF NOT EXISTS team_invites')
    expect(body.teamInvitesMigrationAttempted).toBe(true)
    expect(body.teamInvitesMigrationApplied).toBe(true)
    expect(body.columnsExist).toBe(true)
  })

  it('attempts migration 033 when team_invites schema check is inconclusive', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    let teamInvitesResolved = false
    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      const isTargeted033Only =
        sql.includes('Repair migration: ensure team_invites table exists') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted033Only) {
        teamInvitesResolved = true
      }
    })

    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'team_invites') {
            if (!teamInvitesResolved) {
              return { error: { message: 'permission denied for table team_invites' } }
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(mockRunMigrationSql).toHaveBeenCalledTimes(2)
    expect(body.teamInvitesMigrationAttempted).toBe(true)
    expect(body.teamInvitesMigrationApplied).toBe(true)
    expect(body.inconclusiveChecks ?? []).not.toContain('team_invites')
  })

  it('recovers via migration 033 when full migration throws', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    let teamInvitesMissing = true
    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      const isTargeted033Only =
        sql.includes('Repair migration: ensure team_invites table exists') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted033Only) {
        teamInvitesMissing = false
        return
      }
      throw new Error('member_profiles_user_roles_check violated')
    })

    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'team_invites' && teamInvitesMissing) {
            return {
              error: { message: 'relation "team_invites" does not exist' },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(mockRunMigrationSql).toHaveBeenCalledTimes(2)
    expect(body.teamInvitesMigrationAttempted).toBe(true)
    expect(body.teamInvitesMigrationApplied).toBe(true)
    expect(body.applied).toBe(true)
    expect(body.needsManualRun).toBe(true)
    expect(body.error).toBe('Migration operation failed. Check server logs for details.')
  })

  it('applies migration 022+023 when profile_change_requests remains missing after full migration', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    let profileChangeRequestsMissing = true
    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      const isTargeted022 =
        sql.includes('CREATE TABLE IF NOT EXISTS profile_change_requests') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted022) {
        profileChangeRequestsMissing = false
      }
    })

    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'profile_change_requests' && profileChangeRequestsMissing) {
            return {
              error: { message: 'relation "profile_change_requests" does not exist' },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(mockRunMigrationSql).toHaveBeenCalledTimes(2)
    expect(mockRunMigrationSql.mock.calls[1][0]).toContain(
      'CREATE TABLE IF NOT EXISTS profile_change_requests'
    )
    expect(mockRunMigrationSql.mock.calls[1][0]).toContain(
      'Users can delete own pending profile change requests'
    )
    expect(body.profileChangeRequestsMigrationAttempted).toBe(true)
    expect(body.profileChangeRequestsMigrationApplied).toBe(true)
    expect(body.columnsExist).toBe(true)
  })

  it('recovers via migration 022+023 when full migration throws', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    let profileChangeRequestsMissing = true
    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      const isTargeted022 =
        sql.includes('CREATE TABLE IF NOT EXISTS profile_change_requests') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted022) {
        profileChangeRequestsMissing = false
        return
      }
      throw new Error('member_profiles_user_roles_check violated')
    })

    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'profile_change_requests' && profileChangeRequestsMissing) {
            return {
              error: { message: 'relation "profile_change_requests" does not exist' },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(body.profileChangeRequestsMigrationAttempted).toBe(true)
    expect(body.profileChangeRequestsMigrationApplied).toBe(true)
    expect(body.applied).toBe(true)
    expect(body.needsManualRun).toBe(true)
    expect(body.error).toBe('Migration operation failed. Check server logs for details.')
    expect(
      mockRunMigrationSql.mock.calls.some(
        (call) =>
          String(call[0]).includes('CREATE TABLE IF NOT EXISTS profile_change_requests') &&
          String(call[0]).includes('Users can delete own pending profile change requests')
      )
    ).toBe(true)
  })

  it('applies migration 035 when carrier_connection_invites remains missing after full migration', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    let carrierConnectionInvitesMissing = true
    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      const isTargeted035Only =
        sql.includes('CREATE TABLE IF NOT EXISTS carrier_connection_invites') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted035Only) {
        carrierConnectionInvitesMissing = false
      }
    })

    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'carrier_connection_invites' && carrierConnectionInvitesMissing) {
            return {
              error: { message: 'relation "carrier_connection_invites" does not exist' },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(mockRunMigrationSql).toHaveBeenCalledTimes(2)
    expect(mockRunMigrationSql.mock.calls[1][0]).toContain(
      'CREATE TABLE IF NOT EXISTS carrier_connection_invites'
    )
    // Targeted 035 chains PE so accept inviter is not left on Owner/Admin
    expect(mockRunMigrationSql.mock.calls[1][0]).toContain(
      'enforce_no_self_promote_to_permit_clerk'
    )
    expect(mockRunMigrationSql.mock.calls[1][0]).toMatch(
      /om\.role\s*=\s*'Permit Clerk'/
    )
    expect(body.carrierConnectionInvitesMigrationAttempted).toBe(true)
    expect(body.carrierConnectionInvitesMigrationApplied).toBe(true)
    expect(body.columnsExist).toBe(true)
  })

  it('attempts migration 035 when carrier_connection_invites schema check is inconclusive', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    let carrierConnectionInvitesResolved = false
    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      const isTargeted035Only =
        sql.includes('CREATE TABLE IF NOT EXISTS carrier_connection_invites') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted035Only) {
        carrierConnectionInvitesResolved = true
      }
    })

    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'carrier_connection_invites') {
            if (!carrierConnectionInvitesResolved) {
              return {
                error: { message: 'permission denied for table carrier_connection_invites' },
              }
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(mockRunMigrationSql).toHaveBeenCalledTimes(2)
    expect(body.carrierConnectionInvitesMigrationAttempted).toBe(true)
    expect(body.carrierConnectionInvitesMigrationApplied).toBe(true)
    expect(body.inconclusiveChecks ?? []).not.toContain('carrier_connection_invites')
  })

  it('recovers via migration 035 when full migration throws', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    let carrierConnectionInvitesMissing = true
    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      const isTargeted035Only =
        sql.includes('CREATE TABLE IF NOT EXISTS carrier_connection_invites') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted035Only) {
        carrierConnectionInvitesMissing = false
        return
      }
      throw new Error('member_profiles_user_roles_check violated')
    })

    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'carrier_connection_invites' && carrierConnectionInvitesMissing) {
            return {
              error: { message: 'relation "carrier_connection_invites" does not exist' },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(mockRunMigrationSql).toHaveBeenCalledTimes(2)
    expect(body.carrierConnectionInvitesMigrationAttempted).toBe(true)
    expect(body.carrierConnectionInvitesMigrationApplied).toBe(true)
    expect(body.applied).toBe(true)
    expect(body.needsManualRun).toBe(true)
    expect(body.error).toBe('Migration operation failed. Check server logs for details.')
  })

  it('skips migration 035 when carrier_connection_invites already present', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')
    mockRunMigrationSql.mockResolvedValue(undefined)
    mockSchemaComplete()

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(mockRunMigrationSql).toHaveBeenCalledTimes(1)
    expect(body.carrierConnectionInvitesMigrationAttempted).toBe(false)
    expect(body.carrierConnectionInvitesMigrationApplied).toBe(false)
    expect(body.success).toBe(true)
  })

  it('continues catch recovery when targeted 035 throws so 036 can still apply', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    let roleCheckOk = false
    mockFetchMembershipRoleCheckStatus.mockImplementation(async () => ({
      checked: true,
      ok: roleCheckOk,
      def: roleCheckOk ? ROLE_CHECK_OK_DEF : ROLE_CHECK_LEGACY_DEF,
      profileOk: roleCheckOk,
    }))

    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      const isTargeted035Only =
        sql.includes('CREATE TABLE IF NOT EXISTS carrier_connection_invites') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted035Only) {
        throw new Error('035 DDL failed')
      }
      const isTargeted036 =
        sql.includes('organization_memberships_role_check') &&
        sql.includes('auth_user_service_mode_org_ids') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted036) {
        roleCheckOk = true
        return
      }
      throw new Error('full migration failed')
    })

    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'carrier_connection_invites') {
            return {
              error: { message: 'relation "carrier_connection_invites" does not exist' },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await POST(makePostRequest())
    const body = await res.json()

    // Full throws; 035 is attempted and throws (flags stay false); 036 still runs in its own try
    expect(body.roleCheckMigrationAttempted).toBe(true)
    expect(body.roleCheckMigrationApplied).toBe(true)
    expect(body.applied).toBe(true)
    expect(body.error).toBe('Migration operation failed. Check server logs for details.')
  })

  it('reports applied false when 035 runs but schema still missing', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      // Full + targeted both "succeed" but schema check remains broken
      return undefined
    })

    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'carrier_connection_invites') {
            return {
              error: { message: 'relation "carrier_connection_invites" does not exist' },
            }
          }
          return { error: null }
        },
      }),
    }))

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(body.carrierConnectionInvitesMigrationAttempted).toBe(true)
    expect(body.carrierConnectionInvitesMigrationApplied).toBe(false)
    expect(body.success).toBe(false)
    expect(body.needsManualRun).toBe(true)
  })

  it('applies migration 036 when membership role CHECK remains legacy after full migration', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    let roleCheckOk = false
    mockFetchMembershipRoleCheckStatus.mockImplementation(async () => ({
      checked: true,
      ok: roleCheckOk,
      def: roleCheckOk ? ROLE_CHECK_OK_DEF : ROLE_CHECK_LEGACY_DEF,
    }))
    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      const isTargeted036 =
        sql.includes('organization_memberships_role_check') &&
        sql.includes('auth_user_service_mode_org_ids') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted036) {
        roleCheckOk = true
      }
    })
    mockSchemaComplete()

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(mockRunMigrationSql).toHaveBeenCalledTimes(2)
    expect(mockRunMigrationSql.mock.calls[1][0]).toContain('organization_memberships_role_check')
    expect(body.roleCheckMigrationAttempted).toBe(true)
    expect(body.roleCheckMigrationApplied).toBe(true)
    expect(body.membershipRoleCheckOk).toBe(true)
    expect(body.columnsExist).toBe(true)
  })

  it('recovers via migration 036 when full migration throws and role CHECK is legacy', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')

    let roleCheckOk = false
    mockFetchMembershipRoleCheckStatus.mockImplementation(async () => ({
      checked: true,
      ok: roleCheckOk,
      def: roleCheckOk ? ROLE_CHECK_OK_DEF : ROLE_CHECK_LEGACY_DEF,
    }))
    mockRunMigrationSql.mockImplementation(async (sql: string) => {
      const isTargeted036 =
        sql.includes('organization_memberships_role_check') &&
        sql.includes('auth_user_service_mode_org_ids') &&
        !sql.includes('002_add_cost_and_route_to_permit_requests')
      if (isTargeted036) {
        roleCheckOk = true
        return
      }
      throw new Error('organization_memberships_role_check violated')
    })
    mockSchemaComplete()

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(body.roleCheckMigrationAttempted).toBe(true)
    expect(body.roleCheckMigrationApplied).toBe(true)
    expect(body.applied).toBe(true)
    expect(body.needsManualRun).toBe(true)
    expect(body.error).toBe('Migration operation failed. Check server logs for details.')
  })

  it('returns partial success when SQL applies but columns remain missing', async () => {
    mockGetDatabaseConnectionString.mockReturnValue('postgresql://postgres:secret@localhost/postgres')
    mockRunMigrationSql.mockResolvedValue(undefined)
    mockFrom.mockImplementation((name: string) => ({
      select: () => ({
        limit: async () => {
          if (name === 'rig_configurations') {
            return { error: { message: 'column rig_configurations.is_default does not exist' } }
          }
          return { error: null }
        },
      }),
    }))

    const res = await POST(makePostRequest())
    const body = await res.json()

    expect(body.applied).toBe(true)
    expect(body.success).toBe(false)
    expect(body.needsManualRun).toBe(true)
    expect(body.missingColumns).toEqual(
      expect.arrayContaining(['rig_configurations.is_default'])
    )
  })
})