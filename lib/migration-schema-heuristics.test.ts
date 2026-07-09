import { describe, expect, it } from 'vitest'
import {
  acceptRpcPeStatusFromDef,
  isMissingRelationOrSchemaCacheError,
} from './migration-schema-heuristics.mjs'

describe('isMissingRelationOrSchemaCacheError', () => {
  const table = 'profile_change_requests'

  it('returns false for ok / empty', () => {
    expect(isMissingRelationOrSchemaCacheError('ok', table)).toBe(false)
    expect(isMissingRelationOrSchemaCacheError('', table)).toBe(false)
    expect(isMissingRelationOrSchemaCacheError(null, table)).toBe(false)
    expect(isMissingRelationOrSchemaCacheError(undefined, table)).toBe(false)
  })

  it('returns true for schema cache / does not exist / could not find table', () => {
    expect(
      isMissingRelationOrSchemaCacheError(
        `Could not find the table 'public.${table}' in the schema cache`,
        table
      )
    ).toBe(true)
    expect(
      isMissingRelationOrSchemaCacheError(`relation "${table}" does not exist`, table)
    ).toBe(true)
    expect(
      isMissingRelationOrSchemaCacheError(
        `Could not find the table 'public.${table}' in the database`,
        table
      )
    ).toBe(true)
  })

  it('returns false for permission-denied / RLS / JWT noise (do not re-apply)', () => {
    expect(
      isMissingRelationOrSchemaCacheError(
        `permission denied for table ${table}`,
        table
      )
    ).toBe(false)
    expect(
      isMissingRelationOrSchemaCacheError(
        'new row violates row-level security policy',
        table
      )
    ).toBe(false)
    expect(
      isMissingRelationOrSchemaCacheError('JWT expired', table)
    ).toBe(false)
    expect(
      isMissingRelationOrSchemaCacheError(
        'row-level security policy for table profile_change_requests',
        table
      )
    ).toBe(false)
  })

  it('requires table name for could-not-find-table without schema-cache phrase', () => {
    expect(
      isMissingRelationOrSchemaCacheError(
        "Could not find the table 'public.other_table'",
        table
      )
    ).toBe(false)
  })
})

describe('acceptRpcPeStatusFromDef', () => {
  it('marks PE ok when Clerk equality and no Owner/Admin IN list', () => {
    const def = `
      CREATE FUNCTION accept_carrier_connection_invite(p_token text) ...
      SELECT 1 FROM organization_memberships om
      WHERE om.user_id = v_pending.invited_by_user_id
        AND om.role = 'Permit Clerk';
    `
    expect(acceptRpcPeStatusFromDef(def)).toEqual({
      clerkOnly: true,
      stillOwnerAdmin: false,
      peOk: true,
    })
  })

  it('marks PE not ok when legacy Owner/Admin allowlist present', () => {
    const def = `
      AND om.role IN ('Owner', 'Admin', 'Permit Clerk')
    `
    const status = acceptRpcPeStatusFromDef(def)
    expect(status.stillOwnerAdmin).toBe(true)
    expect(status.peOk).toBe(false)
  })

  it('marks PE not ok when empty def', () => {
    expect(acceptRpcPeStatusFromDef('')).toEqual({
      clerkOnly: false,
      stillOwnerAdmin: false,
      peOk: false,
    })
  })
})
