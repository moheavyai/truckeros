import { describe, expect, it, vi } from 'vitest'
import {
  applyProfileChangeRequestsMigrationIfNeeded,
  profileChangeRequestsTableMissing,
  profileChangeRequestsTablePossiblyMissing,
} from './admin-migrate-profile-change-requests'

describe('admin-migrate-profile-change-requests', () => {
  it('detects missing profile_change_requests table', () => {
    expect(profileChangeRequestsTableMissing(['profile_change_requests.id'])).toBe(true)
    expect(
      profileChangeRequestsTableMissing(['profile_change_requests.organization_id'])
    ).toBe(true)
    expect(
      profileChangeRequestsTableMissing(['profile_change_requests.requester_user_id'])
    ).toBe(true)
    expect(
      profileChangeRequestsTableMissing(['profile_change_requests.target_user_id'])
    ).toBe(true)
    expect(profileChangeRequestsTableMissing(['profile_change_requests.field_key'])).toBe(
      true
    )
    expect(profileChangeRequestsTableMissing(['profile_change_requests.status'])).toBe(true)
    expect(profileChangeRequestsTableMissing(['equipment_profiles.license_plate'])).toBe(
      false
    )
  })

  it('treats inconclusive profile_change_requests check as possibly missing', () => {
    expect(
      profileChangeRequestsTablePossiblyMissing({
        columnsExist: false,
        missingColumns: [],
        inconclusiveChecks: ['profile_change_requests'],
      })
    ).toBe(true)
    expect(
      profileChangeRequestsTablePossiblyMissing({
        columnsExist: false,
        missingColumns: [],
        inconclusiveChecks: ['equipment_profiles'],
      })
    ).toBe(false)
  })

  it('skips migration when profile_change_requests table already exists', async () => {
    const runMigration = vi.fn()
    const result = await applyProfileChangeRequestsMigrationIfNeeded(
      runMigration,
      async () => ({ columnsExist: true, missingColumns: [] }),
      'CREATE TABLE ...'
    )

    expect(result).toEqual({ attempted: false, applied: false })
    expect(runMigration).not.toHaveBeenCalled()
  })

  it('runs profile_change_requests SQL when table is missing', async () => {
    const runMigration = vi.fn()
    let calls = 0

    const result = await applyProfileChangeRequestsMigrationIfNeeded(
      runMigration,
      async () => {
        calls += 1
        return calls === 1
          ? {
              columnsExist: false,
              missingColumns: ['profile_change_requests.id'],
            }
          : { columnsExist: true, missingColumns: [] }
      },
      'CREATE TABLE IF NOT EXISTS profile_change_requests (...);'
    )

    expect(runMigration).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ attempted: true, applied: true })
  })

  it('runs profile_change_requests SQL when check is inconclusive', async () => {
    const runMigration = vi.fn()
    let calls = 0

    const result = await applyProfileChangeRequestsMigrationIfNeeded(
      runMigration,
      async () => {
        calls += 1
        return calls === 1
          ? {
              columnsExist: false,
              missingColumns: [],
              inconclusiveChecks: ['profile_change_requests'],
            }
          : { columnsExist: true, missingColumns: [] }
      },
      'CREATE TABLE IF NOT EXISTS profile_change_requests (...);'
    )

    expect(runMigration).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ attempted: true, applied: true })
  })

  it('reports attempted true and applied false when table still missing after SQL', async () => {
    const runMigration = vi.fn()
    const result = await applyProfileChangeRequestsMigrationIfNeeded(
      runMigration,
      async () => ({
        columnsExist: false,
        missingColumns: ['profile_change_requests.id'],
      }),
      'CREATE TABLE IF NOT EXISTS profile_change_requests (...);'
    )

    expect(runMigration).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ attempted: true, applied: false })
  })
})
