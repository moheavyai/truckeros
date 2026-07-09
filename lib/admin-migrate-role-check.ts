import {
  isLegacyOrMissingMembershipRoleCheck,
  MEMBERSHIP_ROLE_CHECK_DEF_SQL,
  membershipRoleCheckAllowsSplitRoles,
  memberProfilesUserRolesCheckAllowsSplitOwner,
  ROLE_CHECK_HEALTH_SQL,
  roleCheckHealthFromRow,
  roleChecksAllowSplitOwner,
} from './membership-role-check.mjs'
import {
  getDatabaseConnectionString,
  getPgClientConfig,
  getPgSslConfig,
} from './db-migrate'

export {
  isLegacyOrMissingMembershipRoleCheck,
  MEMBERSHIP_ROLE_CHECK_DEF_SQL,
  membershipRoleCheckAllowsSplitRoles,
  memberProfilesUserRolesCheckAllowsSplitOwner,
  ROLE_CHECK_HEALTH_SQL,
  roleCheckHealthFromRow,
  roleChecksAllowSplitOwner,
}

export const MEMBERSHIP_ROLE_CHECK_KEY = 'organization_memberships.role_check'
export const MEMBER_PROFILES_USER_ROLES_CHECK_KEY = 'member_profiles.user_roles_check'
export const ORGANIZATION_MEMBERSHIPS_TABLE = 'organization_memberships'

export type RoleCheckSchemaStatus = {
  columnsExist: boolean
  missingColumns: string[]
  inconclusiveChecks?: string[]
  /** true = memberships + profile CHECKs allow split Owner; false = needs 036; null = not inspected */
  membershipRoleCheckOk?: boolean | null
  membershipRoleCheckDef?: string | null
  memberProfilesUserRolesCheckDef?: string | null
  memberProfilesUserRolesCheckOk?: boolean | null
}

export type RoleCheckMigrationResult = {
  attempted: boolean
  applied: boolean
}

/** True when status explicitly reports a legacy or missing role CHECK set. */
export function membershipRoleCheckNeedsRepair(status: RoleCheckSchemaStatus): boolean {
  return status.membershipRoleCheckOk === false
}

/**
 * Load membership + member_profiles user_roles CHECK health.
 * Uses to_regclass guards — missing tables return ok:false without throwing.
 * Returns checked:false when DATABASE_URL/password is not configured.
 */
export async function fetchMembershipRoleCheckStatus(): Promise<{
  checked: boolean
  ok: boolean | null
  def: string | null
  profileDef: string | null
  profileOk: boolean | null
  membershipsTableExists: boolean | null
  memberProfilesTableExists: boolean | null
  error?: string
}> {
  const connectionString = getDatabaseConnectionString()
  if (!connectionString) {
    return {
      checked: false,
      ok: null,
      def: null,
      profileDef: null,
      profileOk: null,
      membershipsTableExists: null,
      memberProfilesTableExists: null,
    }
  }

  const pg = await import('pg')
  const client = new pg.default.Client(getPgClientConfig(connectionString, getPgSslConfig()))

  try {
    await client.connect()
    const { rows } = await client.query(ROLE_CHECK_HEALTH_SQL)
    const health = roleCheckHealthFromRow(rows[0])
    const ok = roleChecksAllowSplitOwner(health)
    return {
      checked: true,
      ok,
      def: health.membershipDef,
      profileDef: health.profileDef,
      profileOk: health.memberProfilesTableExists
        ? memberProfilesUserRolesCheckAllowsSplitOwner(health.profileDef)
        : null,
      membershipsTableExists: health.membershipsTableExists,
      memberProfilesTableExists: health.memberProfilesTableExists,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      checked: false,
      ok: null,
      def: null,
      profileDef: null,
      profileOk: null,
      membershipsTableExists: null,
      memberProfilesTableExists: null,
      error: message,
    }
  } finally {
    await client.end().catch(() => {})
  }
}

/**
 * Apply migration 036 when role CHECKs are known-bad (false).
 * When forceOnUnknown is true, also apply if status was not inspected (null).
 */
export async function applyMembershipRoleCheckMigrationIfNeeded(
  runMigration: (sql: string) => Promise<void>,
  getSchemaStatus: () => Promise<RoleCheckSchemaStatus>,
  roleCheckSql: string,
  options?: { forceOnUnknown?: boolean }
): Promise<RoleCheckMigrationResult> {
  const before = await getSchemaStatus()

  if (before.membershipRoleCheckOk === true) {
    return { attempted: false, applied: false }
  }

  if (before.membershipRoleCheckOk == null && !options?.forceOnUnknown) {
    return { attempted: false, applied: false }
  }

  await runMigration(roleCheckSql)
  const after = await getSchemaStatus()
  return {
    attempted: true,
    applied: after.membershipRoleCheckOk === true,
  }
}
