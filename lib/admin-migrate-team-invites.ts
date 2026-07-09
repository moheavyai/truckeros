export const TEAM_INVITES_TABLE = 'team_invites'
export const TEAM_INVITES_ORGANIZATION_ID_KEY = 'team_invites.organization_id'
export const TEAM_INVITES_INVITE_TOKEN_KEY = 'team_invites.invite_token'
export const TEAM_INVITES_STATUS_KEY = 'team_invites.status'

export type SchemaStatus = {
  columnsExist: boolean
  missingColumns: string[]
  inconclusiveChecks?: string[]
}

export type TeamInvitesMigrationResult = {
  attempted: boolean
  applied: boolean
}

export function teamInvitesTableMissing(missingColumns: string[]): boolean {
  return (
    missingColumns.includes(TEAM_INVITES_ORGANIZATION_ID_KEY) ||
    missingColumns.includes(TEAM_INVITES_INVITE_TOKEN_KEY) ||
    missingColumns.includes(TEAM_INVITES_STATUS_KEY)
  )
}

/** True when team_invites is known missing or its schema check was inconclusive. */
export function teamInvitesTablePossiblyMissing(status: SchemaStatus): boolean {
  if (teamInvitesTableMissing(status.missingColumns)) return true
  return (status.inconclusiveChecks ?? []).includes(TEAM_INVITES_TABLE)
}

export async function applyTeamInvitesMigrationIfNeeded(
  runMigration: (sql: string) => Promise<void>,
  getSchemaStatus: () => Promise<SchemaStatus>,
  teamInvitesSql: string
): Promise<TeamInvitesMigrationResult> {
  const before = await getSchemaStatus()
  if (!teamInvitesTablePossiblyMissing(before)) {
    return { attempted: false, applied: false }
  }

  await runMigration(teamInvitesSql)
  const after = await getSchemaStatus()
  return {
    attempted: true,
    applied: !teamInvitesTablePossiblyMissing(after),
  }
}