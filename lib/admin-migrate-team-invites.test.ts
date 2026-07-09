import { describe, expect, it, vi } from 'vitest'
import {
  applyTeamInvitesMigrationIfNeeded,
  teamInvitesTableMissing,
  teamInvitesTablePossiblyMissing,
} from './admin-migrate-team-invites'

describe('admin-migrate-team-invites', () => {
  it('detects missing team_invites table', () => {
    expect(teamInvitesTableMissing(['team_invites.organization_id'])).toBe(true)
    expect(teamInvitesTableMissing(['team_invites.invite_token'])).toBe(true)
    expect(teamInvitesTableMissing(['team_invites.status'])).toBe(true)
    expect(teamInvitesTableMissing(['equipment_profiles.license_plate'])).toBe(false)
  })

  it('treats inconclusive team_invites check as possibly missing', () => {
    expect(
      teamInvitesTablePossiblyMissing({
        columnsExist: false,
        missingColumns: [],
        inconclusiveChecks: ['team_invites'],
      })
    ).toBe(true)
    expect(
      teamInvitesTablePossiblyMissing({
        columnsExist: false,
        missingColumns: [],
        inconclusiveChecks: ['equipment_profiles'],
      })
    ).toBe(false)
  })

  it('skips migration when team_invites table already exists', async () => {
    const runMigration = vi.fn()
    const result = await applyTeamInvitesMigrationIfNeeded(
      runMigration,
      async () => ({ columnsExist: true, missingColumns: [] }),
      'CREATE TABLE ...'
    )

    expect(result).toEqual({ attempted: false, applied: false })
    expect(runMigration).not.toHaveBeenCalled()
  })

  it('runs team_invites SQL when table is missing', async () => {
    const runMigration = vi.fn()
    let calls = 0

    const result = await applyTeamInvitesMigrationIfNeeded(
      runMigration,
      async () => {
        calls += 1
        return calls === 1
          ? { columnsExist: false, missingColumns: ['team_invites.organization_id'] }
          : { columnsExist: true, missingColumns: [] }
      },
      'CREATE TABLE IF NOT EXISTS team_invites (...);'
    )

    expect(runMigration).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ attempted: true, applied: true })
  })

  it('runs team_invites SQL when team_invites check is inconclusive', async () => {
    const runMigration = vi.fn()
    let calls = 0

    const result = await applyTeamInvitesMigrationIfNeeded(
      runMigration,
      async () => {
        calls += 1
        return calls === 1
          ? {
              columnsExist: false,
              missingColumns: [],
              inconclusiveChecks: ['team_invites'],
            }
          : { columnsExist: true, missingColumns: [] }
      },
      'CREATE TABLE IF NOT EXISTS team_invites (...);'
    )

    expect(runMigration).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ attempted: true, applied: true })
  })
})