import { describe, expect, it, vi } from 'vitest'
import {
  applyCarrierConnectionInvitesMigrationIfNeeded,
  carrierConnectionInvitesTableMissing,
  carrierConnectionInvitesTablePossiblyMissing,
} from './admin-migrate-carrier-connection-invites'

describe('admin-migrate-carrier-connection-invites', () => {
  it('detects missing carrier_connection_invites table', () => {
    expect(
      carrierConnectionInvitesTableMissing(['carrier_connection_invites.invite_token'])
    ).toBe(true)
    expect(carrierConnectionInvitesTableMissing(['carrier_connection_invites.status'])).toBe(
      true
    )
    expect(
      carrierConnectionInvitesTableMissing(['carrier_connection_invites.company_name'])
    ).toBe(true)
    expect(
      carrierConnectionInvitesTableMissing(['carrier_connection_invites.organization_id'])
    ).toBe(true)
    expect(
      carrierConnectionInvitesTableMissing(['carrier_connection_invites.invite_email'])
    ).toBe(true)
    expect(carrierConnectionInvitesTableMissing(['equipment_profiles.license_plate'])).toBe(
      false
    )
  })

  it('treats inconclusive carrier_connection_invites check as possibly missing', () => {
    expect(
      carrierConnectionInvitesTablePossiblyMissing({
        columnsExist: false,
        missingColumns: [],
        inconclusiveChecks: ['carrier_connection_invites'],
      })
    ).toBe(true)
    expect(
      carrierConnectionInvitesTablePossiblyMissing({
        columnsExist: false,
        missingColumns: [],
        inconclusiveChecks: ['equipment_profiles'],
      })
    ).toBe(false)
  })

  it('skips migration when carrier_connection_invites table already exists', async () => {
    const runMigration = vi.fn()
    const result = await applyCarrierConnectionInvitesMigrationIfNeeded(
      runMigration,
      async () => ({ columnsExist: true, missingColumns: [] }),
      'CREATE TABLE ...'
    )

    expect(result).toEqual({ attempted: false, applied: false })
    expect(runMigration).not.toHaveBeenCalled()
  })

  it('runs carrier_connection_invites SQL when table is missing', async () => {
    const runMigration = vi.fn()
    let calls = 0

    const result = await applyCarrierConnectionInvitesMigrationIfNeeded(
      runMigration,
      async () => {
        calls += 1
        return calls === 1
          ? {
              columnsExist: false,
              missingColumns: ['carrier_connection_invites.invite_token'],
            }
          : { columnsExist: true, missingColumns: [] }
      },
      'CREATE TABLE IF NOT EXISTS carrier_connection_invites (...);'
    )

    expect(runMigration).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ attempted: true, applied: true })
  })

  it('runs carrier_connection_invites SQL when check is inconclusive', async () => {
    const runMigration = vi.fn()
    let calls = 0

    const result = await applyCarrierConnectionInvitesMigrationIfNeeded(
      runMigration,
      async () => {
        calls += 1
        return calls === 1
          ? {
              columnsExist: false,
              missingColumns: [],
              inconclusiveChecks: ['carrier_connection_invites'],
            }
          : { columnsExist: true, missingColumns: [] }
      },
      'CREATE TABLE IF NOT EXISTS carrier_connection_invites (...);'
    )

    expect(runMigration).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ attempted: true, applied: true })
  })

  it('reports attempted true and applied false when table still missing after SQL', async () => {
    const runMigration = vi.fn()
    const result = await applyCarrierConnectionInvitesMigrationIfNeeded(
      runMigration,
      async () => ({
        columnsExist: false,
        missingColumns: ['carrier_connection_invites.invite_token'],
      }),
      'CREATE TABLE IF NOT EXISTS carrier_connection_invites (...);'
    )

    expect(runMigration).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ attempted: true, applied: false })
  })
})
