import { describe, expect, it, vi } from 'vitest'
import {
  applyMembershipRoleCheckMigrationIfNeeded,
  membershipRoleCheckAllowsSplitRoles,
  memberProfilesUserRolesCheckAllowsSplitOwner,
  membershipRoleCheckNeedsRepair,
  roleCheckHealthFromRow,
  roleChecksAllowSplitOwner,
} from './admin-migrate-role-check'

const OK_MEMBERSHIP_DEF =
  "CHECK (role = ANY (ARRAY['Owner'::text, 'Admin'::text, 'Driver'::text, 'Permit Clerk'::text, 'Viewer'::text]))"
const LEGACY_MEMBERSHIP_DEF =
  "CHECK (role = ANY (ARRAY['Owner / Admin'::text, 'Driver'::text, 'Permit Clerk'::text, 'Viewer'::text]))"
const OK_PROFILE_FN_DEF = 'CHECK (member_profile_user_roles_valid(user_roles))'
const OK_PROFILE_ARRAY_DEF =
  "CHECK (user_roles <@ ARRAY['Owner'::text, 'Admin'::text, 'Driver'::text, 'Permit Clerk'::text, 'Viewer'::text])"
const LEGACY_PROFILE_DEF =
  "CHECK (user_roles <@ ARRAY['Owner / Admin'::text, 'Driver'::text, 'Permit Clerk'::text, 'Viewer'::text])"

describe('membershipRoleCheckAllowsSplitRoles', () => {
  it('accepts split Owner/Admin allowlist', () => {
    expect(membershipRoleCheckAllowsSplitRoles(OK_MEMBERSHIP_DEF)).toBe(true)
  })

  it('rejects legacy Owner / Admin allowlist', () => {
    expect(membershipRoleCheckAllowsSplitRoles(LEGACY_MEMBERSHIP_DEF)).toBe(false)
    expect(membershipRoleCheckAllowsSplitRoles(null)).toBe(false)
    expect(membershipRoleCheckAllowsSplitRoles('')).toBe(false)
  })
})

describe('memberProfilesUserRolesCheckAllowsSplitOwner', () => {
  it('accepts function-based and array allowlists with Owner', () => {
    expect(memberProfilesUserRolesCheckAllowsSplitOwner(OK_PROFILE_FN_DEF)).toBe(true)
    expect(memberProfilesUserRolesCheckAllowsSplitOwner(OK_PROFILE_ARRAY_DEF)).toBe(true)
  })

  it('rejects legacy profile allowlist', () => {
    expect(memberProfilesUserRolesCheckAllowsSplitOwner(LEGACY_PROFILE_DEF)).toBe(false)
    expect(memberProfilesUserRolesCheckAllowsSplitOwner(null)).toBe(false)
  })
})

describe('roleChecksAllowSplitOwner', () => {
  it('requires memberships table + modern membership CHECK', () => {
    expect(
      roleChecksAllowSplitOwner(
        roleCheckHealthFromRow({
          membership_def: null,
          profile_def: null,
          memberships_table_exists: false,
          member_profiles_table_exists: false,
        })
      )
    ).toBe(false)
  })

  it('fails when membership CHECK is legacy even if profile is modern', () => {
    expect(
      roleChecksAllowSplitOwner({
        membershipDef: LEGACY_MEMBERSHIP_DEF,
        profileDef: OK_PROFILE_FN_DEF,
        membershipsTableExists: true,
        memberProfilesTableExists: true,
      })
    ).toBe(false)
  })

  it('fails when membership OK but profile CHECK is legacy', () => {
    expect(
      roleChecksAllowSplitOwner({
        membershipDef: OK_MEMBERSHIP_DEF,
        profileDef: LEGACY_PROFILE_DEF,
        membershipsTableExists: true,
        memberProfilesTableExists: true,
      })
    ).toBe(false)
  })

  it('passes when both CHECKs allow split Owner', () => {
    expect(
      roleChecksAllowSplitOwner({
        membershipDef: OK_MEMBERSHIP_DEF,
        profileDef: OK_PROFILE_FN_DEF,
        membershipsTableExists: true,
        memberProfilesTableExists: true,
      })
    ).toBe(true)
  })
})

describe('membershipRoleCheckNeedsRepair', () => {
  it('is true only when explicitly false', () => {
    expect(
      membershipRoleCheckNeedsRepair({
        columnsExist: true,
        missingColumns: [],
        membershipRoleCheckOk: false,
      })
    ).toBe(true)
    expect(
      membershipRoleCheckNeedsRepair({
        columnsExist: true,
        missingColumns: [],
        membershipRoleCheckOk: true,
      })
    ).toBe(false)
    expect(
      membershipRoleCheckNeedsRepair({
        columnsExist: true,
        missingColumns: [],
        membershipRoleCheckOk: null,
      })
    ).toBe(false)
  })
})

describe('applyMembershipRoleCheckMigrationIfNeeded', () => {
  it('skips when CHECK already allows split roles', async () => {
    const runMigration = vi.fn()
    const result = await applyMembershipRoleCheckMigrationIfNeeded(
      runMigration,
      async () => ({ columnsExist: true, missingColumns: [], membershipRoleCheckOk: true }),
      'ALTER ...'
    )
    expect(result).toEqual({ attempted: false, applied: false })
    expect(runMigration).not.toHaveBeenCalled()
  })

  it('skips unknown status unless forceOnUnknown', async () => {
    const runMigration = vi.fn()
    const result = await applyMembershipRoleCheckMigrationIfNeeded(
      runMigration,
      async () => ({ columnsExist: true, missingColumns: [], membershipRoleCheckOk: null }),
      'ALTER ...'
    )
    expect(result).toEqual({ attempted: false, applied: false })
    expect(runMigration).not.toHaveBeenCalled()
  })

  it('runs 036 when CHECK is legacy', async () => {
    const runMigration = vi.fn()
    let calls = 0
    const result = await applyMembershipRoleCheckMigrationIfNeeded(
      runMigration,
      async () => {
        calls += 1
        return calls === 1
          ? {
              columnsExist: false,
              missingColumns: ['organization_memberships.role_check'],
              membershipRoleCheckOk: false,
            }
          : { columnsExist: true, missingColumns: [], membershipRoleCheckOk: true }
      },
      '-- Repair: organization_memberships_role_check'
    )
    expect(runMigration).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ attempted: true, applied: true })
  })

  it('runs when unknown and forceOnUnknown', async () => {
    const runMigration = vi.fn()
    let calls = 0
    const result = await applyMembershipRoleCheckMigrationIfNeeded(
      runMigration,
      async () => {
        calls += 1
        return calls === 1
          ? { columnsExist: true, missingColumns: [], membershipRoleCheckOk: null }
          : { columnsExist: true, missingColumns: [], membershipRoleCheckOk: true }
      },
      '-- Repair 036',
      { forceOnUnknown: true }
    )
    expect(runMigration).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ attempted: true, applied: true })
  })
})
