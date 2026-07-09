/**
 * Admin migrate detector for profile_change_requests (table/columns only).
 *
 * For a guaranteed full repair (022 table + 023 policies + NOTIFY), use
 * `node scripts/apply-migration-022.mjs` which always applies 022 then 023.
 */
export const PROFILE_CHANGE_REQUESTS_TABLE = 'profile_change_requests'
export const PROFILE_CHANGE_REQUESTS_ID_KEY = 'profile_change_requests.id'
export const PROFILE_CHANGE_REQUESTS_ORGANIZATION_ID_KEY =
  'profile_change_requests.organization_id'
export const PROFILE_CHANGE_REQUESTS_REQUESTER_USER_ID_KEY =
  'profile_change_requests.requester_user_id'
export const PROFILE_CHANGE_REQUESTS_TARGET_USER_ID_KEY =
  'profile_change_requests.target_user_id'
export const PROFILE_CHANGE_REQUESTS_FIELD_KEY_KEY = 'profile_change_requests.field_key'
export const PROFILE_CHANGE_REQUESTS_STATUS_KEY = 'profile_change_requests.status'

export type SchemaStatus = {
  columnsExist: boolean
  missingColumns: string[]
  inconclusiveChecks?: string[]
}

export type ProfileChangeRequestsMigrationResult = {
  attempted: boolean
  applied: boolean
}

export function profileChangeRequestsTableMissing(missingColumns: string[]): boolean {
  return (
    missingColumns.includes(PROFILE_CHANGE_REQUESTS_ID_KEY) ||
    missingColumns.includes(PROFILE_CHANGE_REQUESTS_ORGANIZATION_ID_KEY) ||
    missingColumns.includes(PROFILE_CHANGE_REQUESTS_REQUESTER_USER_ID_KEY) ||
    missingColumns.includes(PROFILE_CHANGE_REQUESTS_TARGET_USER_ID_KEY) ||
    missingColumns.includes(PROFILE_CHANGE_REQUESTS_FIELD_KEY_KEY) ||
    missingColumns.includes(PROFILE_CHANGE_REQUESTS_STATUS_KEY)
  )
}

/** True when profile_change_requests is known missing or its schema check was inconclusive. */
export function profileChangeRequestsTablePossiblyMissing(status: SchemaStatus): boolean {
  if (profileChangeRequestsTableMissing(status.missingColumns)) return true
  return (status.inconclusiveChecks ?? []).includes(PROFILE_CHANGE_REQUESTS_TABLE)
}

/**
 * Apply 022 (+ optional 023 policies) when the table appears missing.
 * Pass combined SQL (022 then 023) for full policy coverage.
 */
export async function applyProfileChangeRequestsMigrationIfNeeded(
  runMigration: (sql: string) => Promise<void>,
  getSchemaStatus: () => Promise<SchemaStatus>,
  profileChangeRequestsSql: string
): Promise<ProfileChangeRequestsMigrationResult> {
  const before = await getSchemaStatus()
  if (!profileChangeRequestsTablePossiblyMissing(before)) {
    return { attempted: false, applied: false }
  }

  await runMigration(profileChangeRequestsSql)
  const after = await getSchemaStatus()
  return {
    attempted: true,
    applied: !profileChangeRequestsTablePossiblyMissing(after),
  }
}
