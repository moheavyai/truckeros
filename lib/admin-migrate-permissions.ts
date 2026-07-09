export const TEAM_MEMBER_PERMISSIONS_COLUMN_KEY = 'team_member_profiles.permissions'
export const TEAM_MEMBER_PROFILES_TABLE = 'team_member_profiles'

export type SchemaStatus = {
  columnsExist: boolean
  missingColumns: string[]
  inconclusiveChecks?: string[]
}

export type PermissionsMigrationResult = {
  attempted: boolean
  applied: boolean
}

export function permissionsColumnMissing(missingColumns: string[]): boolean {
  return missingColumns.includes(TEAM_MEMBER_PERMISSIONS_COLUMN_KEY)
}

/** True when permissions are known missing or team_member_profiles check was inconclusive. */
export function permissionsColumnPossiblyMissing(status: SchemaStatus): boolean {
  if (permissionsColumnMissing(status.missingColumns)) return true
  return (status.inconclusiveChecks ?? []).includes(TEAM_MEMBER_PROFILES_TABLE)
}

export async function applyTeamMemberPermissionsMigrationIfNeeded(
  runMigration: (sql: string) => Promise<void>,
  getSchemaStatus: () => Promise<SchemaStatus>,
  permissionsSql: string
): Promise<PermissionsMigrationResult> {
  const before = await getSchemaStatus()
  if (!permissionsColumnPossiblyMissing(before)) {
    return { attempted: false, applied: false }
  }

  await runMigration(permissionsSql)
  const after = await getSchemaStatus()
  return {
    attempted: true,
    applied: !permissionsColumnPossiblyMissing(after),
  }
}