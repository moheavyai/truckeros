import { describe, expect, it, vi } from 'vitest'
import {
  applyTeamMemberPermissionsMigrationIfNeeded,
  permissionsColumnMissing,
  permissionsColumnPossiblyMissing,
} from './admin-migrate-permissions'

describe('admin-migrate-permissions', () => {
  it('detects missing permissions column', () => {
    expect(permissionsColumnMissing(['team_member_profiles.permissions'])).toBe(true)
    expect(permissionsColumnMissing(['equipment_profiles.license_plate'])).toBe(false)
  })

  it('treats inconclusive team_member_profiles check as possibly missing permissions', () => {
    expect(
      permissionsColumnPossiblyMissing({
        columnsExist: false,
        missingColumns: [],
        inconclusiveChecks: ['team_member_profiles'],
      })
    ).toBe(true)
    expect(
      permissionsColumnPossiblyMissing({
        columnsExist: false,
        missingColumns: [],
        inconclusiveChecks: ['equipment_profiles'],
      })
    ).toBe(false)
  })

  it('skips migration when permissions column already exists', async () => {
    const runMigration = vi.fn()
    const result = await applyTeamMemberPermissionsMigrationIfNeeded(
      runMigration,
      async () => ({ columnsExist: true, missingColumns: [] }),
      'ALTER ...'
    )

    expect(result).toEqual({ attempted: false, applied: false })
    expect(runMigration).not.toHaveBeenCalled()
  })

  it('runs permissions SQL when column is missing', async () => {
    const runMigration = vi.fn()
    let calls = 0

    const result = await applyTeamMemberPermissionsMigrationIfNeeded(
      runMigration,
      async () => {
        calls += 1
        return calls === 1
          ? { columnsExist: false, missingColumns: ['team_member_profiles.permissions'] }
          : { columnsExist: true, missingColumns: [] }
      },
      'ALTER TABLE team_member_profiles ADD COLUMN permissions jsonb;'
    )

    expect(runMigration).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ attempted: true, applied: true })
  })

  it('runs permissions SQL when team_member_profiles check is inconclusive', async () => {
    const runMigration = vi.fn()
    let calls = 0

    const result = await applyTeamMemberPermissionsMigrationIfNeeded(
      runMigration,
      async () => {
        calls += 1
        return calls === 1
          ? {
              columnsExist: false,
              missingColumns: [],
              inconclusiveChecks: ['team_member_profiles'],
            }
          : { columnsExist: true, missingColumns: [] }
      },
      'ALTER TABLE team_member_profiles ADD COLUMN permissions jsonb;'
    )

    expect(runMigration).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ attempted: true, applied: true })
  })
})