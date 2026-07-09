import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { applyCarrierConnectionInvitesMigrationIfNeeded } from '@/lib/admin-migrate-carrier-connection-invites'
import { applyTeamMemberPermissionsMigrationIfNeeded } from '@/lib/admin-migrate-permissions'
import { applyProfileChangeRequestsMigrationIfNeeded } from '@/lib/admin-migrate-profile-change-requests'
import {
  applyMembershipRoleCheckMigrationIfNeeded,
  fetchMembershipRoleCheckStatus,
  MEMBER_PROFILES_USER_ROLES_CHECK_KEY,
  MEMBERSHIP_ROLE_CHECK_KEY,
  membershipRoleCheckAllowsSplitRoles,
} from '@/lib/admin-migrate-role-check'
import { applyTeamInvitesMigrationIfNeeded } from '@/lib/admin-migrate-team-invites'
import { requireAdminUser } from '@/lib/admin-auth'
import { getDatabaseConnectionString, runMigrationSql } from '@/lib/db-migrate'
import {
  getFullApiMigrationSql,
  getMigration002Sql,
  getMigration014Sql,
  getMigration017Sql,
  getMigration022Sql,
  getMigration023Sql,
  getMigration031Sql,
  getMigration033Sql,
  getMigration035Sql,
  getMigration036Sql,
  getMigration037Sql,
  getMigration038Sql,
  getMigration039Sql,
  getMigration040Sql,
  getMigration041Sql,
} from '@/lib/migrations'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const MIGRATION_002_SQL = getMigration002Sql()
const MIGRATION_014_SQL = getMigration014Sql()
const MIGRATION_017_SQL = getMigration017Sql()
const MIGRATION_022_SQL = getMigration022Sql()
const MIGRATION_023_SQL = getMigration023Sql()
/** 022 table + 023 policies for targeted profile_change_requests recovery. */
const MIGRATION_022_WITH_023_SQL = [MIGRATION_022_SQL, MIGRATION_023_SQL].join('\n\n')
const MIGRATION_031_SQL = getMigration031Sql()
const MIGRATION_033_SQL = getMigration033Sql()
const MIGRATION_035_SQL = getMigration035Sql()
const MIGRATION_036_SQL = getMigration036Sql()
const MIGRATION_037_SQL = getMigration037Sql()
const MIGRATION_038_SQL = getMigration038Sql()
const MIGRATION_039_SQL = getMigration039Sql()
const MIGRATION_040_SQL = getMigration040Sql()
const MIGRATION_041_SQL = getMigration041Sql()
/**
 * Targeted 035 overwrites accept/manage RPCs to pre-PE Owner/Admin allowlist.
 * Always chain PE 038–041 so inviter stays Permit Clerk only.
 */
const MIGRATION_035_WITH_PE_SQL = [
  MIGRATION_035_SQL,
  MIGRATION_038_SQL,
  MIGRATION_039_SQL,
  MIGRATION_040_SQL,
  MIGRATION_041_SQL,
].join('\n\n')
const MIGRATION_SQL = getFullApiMigrationSql()

type SchemaCheck = {
  table: string
  columns: readonly string[]
}

const SCHEMA_CHECKS: SchemaCheck[] = [
  {
    table: 'permit_requests',
    columns: [
      'cost_breakdown',
      'distance_miles',
      'duration_hours',
      'origin_query',
      'destination_query',
      'drops',
    ],
  },
  {
    table: 'equipment_profiles',
    columns: ['license_plate', 'license_plate_state'],
  },
  {
    table: 'rig_configurations',
    columns: ['is_default'],
  },
  {
    table: 'member_profiles',
    columns: ['company_name', 'user_roles'],
  },
  {
    table: 'team_member_profiles',
    columns: ['permissions'],
  },
  {
    table: 'team_invites',
    columns: ['organization_id', 'invite_token', 'status'],
  },
  {
    table: 'profile_change_requests',
    columns: [
      'id',
      'organization_id',
      'requester_user_id',
      'target_user_id',
      'field_key',
      'status',
    ],
  },
  {
    table: 'carrier_connection_invites',
    columns: ['invite_token', 'status', 'company_name', 'organization_id', 'invite_email'],
  },
]

type TableCheckResult = {
  table: string
  columnsExist: boolean | null
  missingColumns: string[]
  error: string | null
  inconclusive: boolean
}

function logAndSanitizeError(err: unknown, context: string): { message: string; correlationId: string } {
  const correlationId = randomUUID()
  const fullMessage = err instanceof Error ? err.message : String(err)
  console.error(`[admin/migrate] ${context}:`, fullMessage, { correlationId })
  return {
    message: 'Migration operation failed. Check server logs for details.',
    correlationId,
  }
}

async function checkTableColumns(check: SchemaCheck): Promise<TableCheckResult> {
  if (!supabaseAdmin) {
    return {
      table: check.table,
      columnsExist: false,
      missingColumns: [...check.columns],
      error: 'No admin client',
      inconclusive: false,
    }
  }

  const { error } = await supabaseAdmin
    .from(check.table)
    .select(check.columns.join(', '))
    .limit(1)

  if (!error) {
    return {
      table: check.table,
      columnsExist: true,
      missingColumns: [],
      error: null,
      inconclusive: false,
    }
  }

  const message = error.message || ''
  const missingColumns = check.columns.filter((col) => message.includes(col))
  const relationMissing =
    message.includes('does not exist') &&
    (message.includes(`relation "${check.table}"`) || message.includes(`"${check.table}"`))

  if (message) {
    console.error(`[admin/migrate] schema check failed for ${check.table}:`, message)
  }

  if (relationMissing) {
    return {
      table: check.table,
      columnsExist: false,
      missingColumns: [...check.columns],
      error: 'Schema check failed for this table. See server logs.',
      inconclusive: false,
    }
  }

  if (missingColumns.length === 0 && message) {
    return {
      table: check.table,
      columnsExist: null,
      missingColumns: [],
      error: 'Schema check inconclusive. See server logs.',
      inconclusive: true,
    }
  }

  return {
    table: check.table,
    columnsExist: false,
    missingColumns: missingColumns.length > 0 ? missingColumns : [...check.columns],
    error: message ? 'Schema check failed for this table. See server logs.' : null,
    inconclusive: false,
  }
}

const ORGANIZATION_MEMBERSHIPS_ROLE_CHECK_INCONCLUSIVE = 'organization_memberships.role_check'

async function getSchemaStatus() {
  const tableResults = await Promise.all(SCHEMA_CHECKS.map(checkTableColumns))
  const tableColumnsOk = tableResults.every((r) => r.columnsExist === true)
  const tableNeedsMigration = tableResults.some((r) => r.columnsExist === false || r.inconclusive)
  const missingColumns = tableResults.flatMap((r) =>
    r.columnsExist === false ? r.missingColumns.map((col) => `${r.table}.${col}`) : []
  )
  const inconclusiveChecks = tableResults.filter((r) => r.inconclusive).map((r) => r.table)

  const roleCheck = await fetchMembershipRoleCheckStatus()
  const membershipRoleCheckOk: boolean | null = roleCheck.ok
  if (roleCheck.checked && roleCheck.ok === false) {
    if (
      roleCheck.membershipsTableExists === false ||
      !membershipRoleCheckAllowsSplitRoles(roleCheck.def)
    ) {
      missingColumns.push(MEMBERSHIP_ROLE_CHECK_KEY)
    }
    if (roleCheck.memberProfilesTableExists && roleCheck.profileOk === false) {
      missingColumns.push(MEMBER_PROFILES_USER_ROLES_CHECK_KEY)
    }
    // Tables both missing / empty result: still flag membership key for apply path.
    if (
      !missingColumns.includes(MEMBERSHIP_ROLE_CHECK_KEY) &&
      !missingColumns.includes(MEMBER_PROFILES_USER_ROLES_CHECK_KEY)
    ) {
      missingColumns.push(MEMBERSHIP_ROLE_CHECK_KEY)
    }
  }
  if (!roleCheck.checked && roleCheck.error) {
    inconclusiveChecks.push(ORGANIZATION_MEMBERSHIPS_ROLE_CHECK_INCONCLUSIVE)
    console.error('[admin/migrate] membership role CHECK inspect failed:', roleCheck.error)
  }

  const columnsExist = tableColumnsOk && membershipRoleCheckOk !== false
  const needsMigration =
    tableNeedsMigration || membershipRoleCheckOk === false || inconclusiveChecks.length > 0

  return {
    columnsExist,
    needsMigration,
    tableResults,
    missingColumns,
    inconclusiveChecks,
    membershipRoleCheckOk,
    membershipRoleCheckDef: roleCheck.def,
    memberProfilesUserRolesCheckDef: roleCheck.profileDef,
    memberProfilesUserRolesCheckOk: roleCheck.profileOk,
    error:
      tableResults.some((r) => r.error) &&
      inconclusiveChecks.length === 0 &&
      membershipRoleCheckOk !== false
        ? 'One or more schema checks failed. See server logs for details.'
        : membershipRoleCheckOk === false
          ? 'organization_memberships and/or member_profiles role CHECKs are legacy or missing (needs migration 036).'
          : inconclusiveChecks.length > 0
            ? 'One or more schema checks were inconclusive. See server logs for details.'
            : null,
  }
}

/**
 * Reject cross-origin POSTs that could trigger cookie-authenticated DDL (CSRF).
 * Same-origin browser requests include Origin matching Host; Supabase auth cookies
 * also use SameSite=Lax, which blocks cross-site POSTs from carrying the session.
 */
export function isSameOriginPostRequest(request: Request): boolean {
  const host = request.headers.get('host')
  if (!host) {
    return false
  }

  const origin = request.headers.get('origin')
  if (origin) {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }

  const referer = request.headers.get('referer')
  if (referer) {
    try {
      return new URL(referer).host === host
    } catch {
      return false
    }
  }

  // Non-browser clients (curl, scripts) may omit Origin/Referer.
  return true
}

function buildManualPayload() {
  return {
    sql: MIGRATION_SQL,
    migration002Sql: MIGRATION_002_SQL,
    migration014Sql: MIGRATION_014_SQL,
    migration017Sql: MIGRATION_017_SQL,
    migration022Sql: MIGRATION_022_SQL,
    migration023Sql: MIGRATION_023_SQL,
    migration031Sql: MIGRATION_031_SQL,
    migration033Sql: MIGRATION_033_SQL,
    migration035Sql: MIGRATION_035_SQL,
    migration036Sql: MIGRATION_036_SQL,
    migration037Sql: MIGRATION_037_SQL,
    migration038Sql: MIGRATION_038_SQL,
    migration039Sql: MIGRATION_039_SQL,
    migration040Sql: MIGRATION_040_SQL,
    migration041Sql: MIGRATION_041_SQL,
    instructions: [
      '1. Go to your Supabase Dashboard',
      '2. Open the SQL Editor',
      '3. Paste the SQL above and click "Run"',
      '4. If profile_change_requests is missing (Profile approval), run migration022Sql then migration023Sql',
      '5. If carrier_connection_invites is missing (Carriers page), run migration035Sql then migration038Sql–041 (PE)',
      '6. If organization_memberships_role_check still rejects Owner/Admin, run migration036Sql',
      '7. For Phase 1b (membership SELECT + SM helper Permit Clerk only), run migration037Sql',
      '8. For Phase 1 PE (self-Clerk triggers + accept inviter Clerk), run migration038Sql',
      '9. For Phase 1 PE self-INSERT Clerk block + invite accept GUC, run migration039Sql',
      '10. For Phase 1 PE team_invites self-Clerk on UPDATE, run migration040Sql',
      '11. For Phase 1 PE team_invites self-Clerk session match (not invited_by only), run migration041Sql',
      '12. If save still fails with schema cache errors, run: NOTIFY pgrst, \'reload schema\';',
      '13. Refresh GET /api/admin/migrate — all required columns and role CHECK should be detected',
    ],
  }
}

export async function GET() {
  const auth = await requireAdminUser()
  if ('response' in auth) {
    return auth.response
  }

  if (!supabaseAdmin) {
    return NextResponse.json({
      hasAdmin: false,
      columnsExist: null,
      message: 'No service role key found',
    })
  }

  try {
    const status = await getSchemaStatus()

    return NextResponse.json({
      hasAdmin: true,
      ...status,
      requiredColumns: SCHEMA_CHECKS.flatMap((c) => c.columns.map((col) => `${c.table}.${col}`)),
      migration002Sql: MIGRATION_002_SQL,
      migration014Sql: MIGRATION_014_SQL,
      migration017Sql: MIGRATION_017_SQL,
      migration022Sql: MIGRATION_022_SQL,
      migration023Sql: MIGRATION_023_SQL,
      migration031Sql: MIGRATION_031_SQL,
      migration033Sql: MIGRATION_033_SQL,
      migration035Sql: MIGRATION_035_SQL,
      migration036Sql: MIGRATION_036_SQL,
      migration037Sql: MIGRATION_037_SQL,
      migration038Sql: MIGRATION_038_SQL,
      migration039Sql: MIGRATION_039_SQL,
      migration040Sql: MIGRATION_040_SQL,
      migration041Sql: MIGRATION_041_SQL,
    })
  } catch (err: unknown) {
    const { message, correlationId } = logAndSanitizeError(err, 'GET schema status')
    return NextResponse.json({
      hasAdmin: true,
      columnsExist: false,
      needsMigration: true,
      error: message,
      correlationId,
    })
  }
}

export async function POST(request: Request) {
  if (!isSameOriginPostRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const auth = await requireAdminUser()
  if ('response' in auth) {
    return auth.response
  }

  const manualPayload = buildManualPayload()

  if (!supabaseAdmin) {
    return NextResponse.json({
      success: false,
      hasAdmin: false,
      needsManualRun: true,
      ...manualPayload,
      message: 'No service role key found',
    })
  }

  const allowLiveInProduction = process.env.MIGRATE_ALLOW_LIVE_IN_PRODUCTION === 'true'
  if (process.env.NODE_ENV === 'production' && !allowLiveInProduction) {
    return NextResponse.json(
      {
        success: false,
        hasAdmin: true,
        applied: false,
        needsManualRun: true,
        ...manualPayload,
        message:
          'Live migration is disabled in production. Set MIGRATE_ALLOW_LIVE_IN_PRODUCTION=true or run SQL manually in Supabase.',
      },
      { status: 403 }
    )
  }

  const canRunLive = !!getDatabaseConnectionString()
  if (!canRunLive) {
    return NextResponse.json({
      success: false,
      hasAdmin: true,
      needsManualRun: true,
      ...manualPayload,
      message:
        'Set DATABASE_URL or SUPABASE_DB_PASSWORD in .env.local to apply migrations automatically.',
    })
  }

  let permissionsMigrationAttempted = false
  let permissionsMigrationApplied = false
  let teamInvitesMigrationAttempted = false
  let teamInvitesMigrationApplied = false
  let profileChangeRequestsMigrationAttempted = false
  let profileChangeRequestsMigrationApplied = false
  let carrierConnectionInvitesMigrationAttempted = false
  let carrierConnectionInvitesMigrationApplied = false
  let roleCheckMigrationAttempted = false
  let roleCheckMigrationApplied = false
  let applied = false

  try {
    if (process.env.NODE_ENV === 'production' && allowLiveInProduction) {
      console.warn(
        '[admin/migrate] MIGRATE_ALLOW_LIVE_IN_PRODUCTION=true — applying live DDL in production.'
      )
    }

    await runMigrationSql(MIGRATION_SQL)
    applied = true

    const permissionsResult = await applyTeamMemberPermissionsMigrationIfNeeded(
      runMigrationSql,
      getSchemaStatus,
      MIGRATION_031_SQL
    )
    permissionsMigrationAttempted = permissionsResult.attempted
    permissionsMigrationApplied = permissionsResult.applied

    const teamInvitesResult = await applyTeamInvitesMigrationIfNeeded(
      runMigrationSql,
      getSchemaStatus,
      MIGRATION_033_SQL
    )
    teamInvitesMigrationAttempted = teamInvitesResult.attempted
    teamInvitesMigrationApplied = teamInvitesResult.applied

    const profileChangeRequestsResult = await applyProfileChangeRequestsMigrationIfNeeded(
      runMigrationSql,
      getSchemaStatus,
      MIGRATION_022_WITH_023_SQL
    )
    profileChangeRequestsMigrationAttempted = profileChangeRequestsResult.attempted
    profileChangeRequestsMigrationApplied = profileChangeRequestsResult.applied

    const carrierConnectionInvitesResult =
      await applyCarrierConnectionInvitesMigrationIfNeeded(
        runMigrationSql,
        getSchemaStatus,
        MIGRATION_035_WITH_PE_SQL
      )
    carrierConnectionInvitesMigrationAttempted = carrierConnectionInvitesResult.attempted
    carrierConnectionInvitesMigrationApplied = carrierConnectionInvitesResult.applied

    const roleCheckResult = await applyMembershipRoleCheckMigrationIfNeeded(
      runMigrationSql,
      getSchemaStatus,
      MIGRATION_036_SQL
    )
    roleCheckMigrationAttempted = roleCheckResult.attempted
    roleCheckMigrationApplied = roleCheckResult.applied

    const status = await getSchemaStatus()

    return NextResponse.json({
      success: status.columnsExist,
      hasAdmin: true,
      applied: true,
      needsManualRun: !status.columnsExist,
      permissionsMigrationAttempted,
      permissionsMigrationApplied,
      teamInvitesMigrationAttempted,
      teamInvitesMigrationApplied,
      profileChangeRequestsMigrationAttempted,
      profileChangeRequestsMigrationApplied,
      carrierConnectionInvitesMigrationAttempted,
      carrierConnectionInvitesMigrationApplied,
      roleCheckMigrationAttempted,
      roleCheckMigrationApplied,
      ...status,
      ...manualPayload,
    })
  } catch (err: unknown) {
    const { message, correlationId } = logAndSanitizeError(err, 'POST live migration')

    try {
      const permissionsResult = await applyTeamMemberPermissionsMigrationIfNeeded(
        runMigrationSql,
        getSchemaStatus,
        MIGRATION_031_SQL
      )
      permissionsMigrationAttempted = permissionsResult.attempted
      permissionsMigrationApplied = permissionsResult.applied
      if (permissionsMigrationApplied) {
        applied = true
      }
    } catch (permissionsError: unknown) {
      logAndSanitizeError(permissionsError, 'POST permissions fallback')
    }

    try {
      const teamInvitesResult = await applyTeamInvitesMigrationIfNeeded(
        runMigrationSql,
        getSchemaStatus,
        MIGRATION_033_SQL
      )
      teamInvitesMigrationAttempted = teamInvitesResult.attempted
      teamInvitesMigrationApplied = teamInvitesResult.applied
      if (teamInvitesMigrationApplied) {
        applied = true
      }
    } catch (teamInvitesError: unknown) {
      logAndSanitizeError(teamInvitesError, 'POST team_invites fallback')
    }

    try {
      const profileChangeRequestsResult = await applyProfileChangeRequestsMigrationIfNeeded(
        runMigrationSql,
        getSchemaStatus,
        MIGRATION_022_WITH_023_SQL
      )
      profileChangeRequestsMigrationAttempted = profileChangeRequestsResult.attempted
      profileChangeRequestsMigrationApplied = profileChangeRequestsResult.applied
      if (profileChangeRequestsMigrationApplied) {
        applied = true
      }
    } catch (profileChangeRequestsError: unknown) {
      logAndSanitizeError(profileChangeRequestsError, 'POST profile_change_requests fallback')
    }

    try {
      const carrierConnectionInvitesResult =
        await applyCarrierConnectionInvitesMigrationIfNeeded(
          runMigrationSql,
          getSchemaStatus,
          MIGRATION_035_WITH_PE_SQL
        )
      carrierConnectionInvitesMigrationAttempted = carrierConnectionInvitesResult.attempted
      carrierConnectionInvitesMigrationApplied = carrierConnectionInvitesResult.applied
      if (carrierConnectionInvitesMigrationApplied) {
        applied = true
      }
    } catch (carrierConnectionInvitesError: unknown) {
      logAndSanitizeError(
        carrierConnectionInvitesError,
        'POST carrier_connection_invites fallback'
      )
    }

    try {
      // Force 036 when full migrate failed — stuck CHECK is a common cause and
      // status may be unknown if inspect failed mid-flight.
      const roleCheckResult = await applyMembershipRoleCheckMigrationIfNeeded(
        runMigrationSql,
        getSchemaStatus,
        MIGRATION_036_SQL,
        { forceOnUnknown: true }
      )
      roleCheckMigrationAttempted = roleCheckResult.attempted
      roleCheckMigrationApplied = roleCheckResult.applied
      if (roleCheckMigrationApplied) {
        applied = true
      }
    } catch (roleCheckError: unknown) {
      logAndSanitizeError(roleCheckError, 'POST role_check fallback')
    }

    const status = await getSchemaStatus().catch(() => null)

    return NextResponse.json({
      success: false,
      hasAdmin: true,
      applied,
      needsManualRun: true,
      permissionsMigrationAttempted,
      permissionsMigrationApplied,
      teamInvitesMigrationAttempted,
      teamInvitesMigrationApplied,
      profileChangeRequestsMigrationAttempted,
      profileChangeRequestsMigrationApplied,
      carrierConnectionInvitesMigrationAttempted,
      carrierConnectionInvitesMigrationApplied,
      roleCheckMigrationAttempted,
      roleCheckMigrationApplied,
      ...(status || {}),
      error: message,
      correlationId,
      ...manualPayload,
    })
  }
}