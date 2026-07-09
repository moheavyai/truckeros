/**
 * Shared helpers for organization_memberships.role CHECK and member_profiles
 * user_roles CHECK detection.
 * Used by apply-migrations.mjs and (via import) admin-migrate-role-check.ts.
 *
 * All inspection SQL uses to_regclass so missing tables return NULL defs
 * instead of throwing "relation does not exist".
 */

/**
 * Fetch membership + member_profiles user_roles CHECK defs.
 * Returns null defs when tables or constraints are missing (never throws on missing relation).
 */
export const ROLE_CHECK_HEALTH_SQL = `
SELECT
  (
    SELECT pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    WHERE c.conname = 'organization_memberships_role_check'
      AND c.conrelid = to_regclass('public.organization_memberships')
    LIMIT 1
  ) AS membership_def,
  (
    SELECT pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    WHERE c.conname = 'member_profiles_user_roles_check'
      AND c.conrelid = to_regclass('public.member_profiles')
    LIMIT 1
  ) AS profile_def,
  (to_regclass('public.organization_memberships') IS NOT NULL) AS memberships_table_exists,
  (to_regclass('public.member_profiles') IS NOT NULL) AS member_profiles_table_exists
`.trim()

/** @deprecated Prefer ROLE_CHECK_HEALTH_SQL; kept for single-def callers. */
export const MEMBERSHIP_ROLE_CHECK_DEF_SQL = `
SELECT
  CASE
    WHEN to_regclass('public.organization_memberships') IS NULL THEN NULL
    ELSE (
      SELECT pg_get_constraintdef(c.oid)
      FROM pg_constraint c
      WHERE c.conname = 'organization_memberships_role_check'
        AND c.conrelid = to_regclass('public.organization_memberships')
      LIMIT 1
    )
  END AS def
`.trim()

/**
 * True when the membership role CHECK allowlist includes split Owner + Admin.
 * Legacy 021 def uses 'Owner / Admin' only — that string does not contain the
 * closed token 'Owner' so includes("'Owner'") is false for legacy.
 */
export function membershipRoleCheckAllowsSplitRoles(def) {
  if (!def || typeof def !== 'string') return false
  return (
    def.includes("'Owner'") &&
    def.includes("'Admin'") &&
    def.includes("'Driver'") &&
    def.includes("'Permit Clerk'") &&
    def.includes("'Viewer'")
  )
}

/**
 * True when member_profiles.user_roles CHECK allows distinct Owner (split era).
 * Accepts 030/036 function-based CHECK or array allowlist with 'Owner'+'Admin'.
 * Legacy allowlist with only 'Owner / Admin' returns false.
 */
export function memberProfilesUserRolesCheckAllowsSplitOwner(def) {
  if (!def || typeof def !== 'string') return false
  if (def.includes('member_profile_user_roles_valid')) return true
  return def.includes("'Owner'") && def.includes("'Admin'")
}

export function isLegacyOrMissingMembershipRoleCheck(def) {
  return !membershipRoleCheckAllowsSplitRoles(def)
}

/**
 * Combined health: both membership and (when present) profile CHECKs must allow split Owner.
 * Missing memberships table or missing membership CHECK → not OK.
 * Missing member_profiles table is OK only when memberships table is also missing
 * (greenfield); if memberships exist but profiles CHECK is legacy/missing → not OK.
 */
export function roleChecksAllowSplitOwner(health) {
  if (!health) return false
  const {
    membershipDef,
    profileDef,
    membershipsTableExists,
    memberProfilesTableExists,
  } = health

  if (!membershipsTableExists) return false
  if (!membershipRoleCheckAllowsSplitRoles(membershipDef)) return false

  // Profiles table exists in any multi-carrier install; require modern user_roles CHECK.
  if (memberProfilesTableExists) {
    if (!memberProfilesUserRolesCheckAllowsSplitOwner(profileDef)) return false
  }

  return true
}

/** Map a ROLE_CHECK_HEALTH_SQL row to a plain health object. */
export function roleCheckHealthFromRow(row) {
  if (!row) {
    return {
      membershipDef: null,
      profileDef: null,
      membershipsTableExists: false,
      memberProfilesTableExists: false,
    }
  }
  return {
    membershipDef: row.membership_def ?? row.membershipDef ?? null,
    profileDef: row.profile_def ?? row.profileDef ?? null,
    membershipsTableExists: Boolean(
      row.memberships_table_exists ?? row.membershipsTableExists
    ),
    memberProfilesTableExists: Boolean(
      row.member_profiles_table_exists ?? row.memberProfilesTableExists
    ),
  }
}
