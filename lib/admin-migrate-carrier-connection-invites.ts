/**
 * Admin migrate detector for carrier_connection_invites (table/columns only).
 *
 * Does not probe accept/preview RPCs or triggers — those are cheap to re-apply via
 * CREATE OR REPLACE when full 035 runs. For a guaranteed full repair (RPCs + RLS +
 * NOTIFY), use `node scripts/apply-migration-035.mjs` which always applies the
 * entire migration file.
 */
export const CARRIER_CONNECTION_INVITES_TABLE = 'carrier_connection_invites'
export const CARRIER_CONNECTION_INVITES_INVITE_TOKEN_KEY =
  'carrier_connection_invites.invite_token'
export const CARRIER_CONNECTION_INVITES_STATUS_KEY = 'carrier_connection_invites.status'
export const CARRIER_CONNECTION_INVITES_COMPANY_NAME_KEY =
  'carrier_connection_invites.company_name'
export const CARRIER_CONNECTION_INVITES_ORGANIZATION_ID_KEY =
  'carrier_connection_invites.organization_id'
export const CARRIER_CONNECTION_INVITES_INVITE_EMAIL_KEY =
  'carrier_connection_invites.invite_email'

export type SchemaStatus = {
  columnsExist: boolean
  missingColumns: string[]
  inconclusiveChecks?: string[]
}

export type CarrierConnectionInvitesMigrationResult = {
  attempted: boolean
  applied: boolean
}

export function carrierConnectionInvitesTableMissing(missingColumns: string[]): boolean {
  return (
    missingColumns.includes(CARRIER_CONNECTION_INVITES_INVITE_TOKEN_KEY) ||
    missingColumns.includes(CARRIER_CONNECTION_INVITES_STATUS_KEY) ||
    missingColumns.includes(CARRIER_CONNECTION_INVITES_COMPANY_NAME_KEY) ||
    missingColumns.includes(CARRIER_CONNECTION_INVITES_ORGANIZATION_ID_KEY) ||
    missingColumns.includes(CARRIER_CONNECTION_INVITES_INVITE_EMAIL_KEY)
  )
}

/** True when carrier_connection_invites is known missing or its schema check was inconclusive. */
export function carrierConnectionInvitesTablePossiblyMissing(status: SchemaStatus): boolean {
  if (carrierConnectionInvitesTableMissing(status.missingColumns)) return true
  return (status.inconclusiveChecks ?? []).includes(CARRIER_CONNECTION_INVITES_TABLE)
}

export async function applyCarrierConnectionInvitesMigrationIfNeeded(
  runMigration: (sql: string) => Promise<void>,
  getSchemaStatus: () => Promise<SchemaStatus>,
  carrierConnectionInvitesSql: string
): Promise<CarrierConnectionInvitesMigrationResult> {
  const before = await getSchemaStatus()
  if (!carrierConnectionInvitesTablePossiblyMissing(before)) {
    return { attempted: false, applied: false }
  }

  await runMigration(carrierConnectionInvitesSql)
  const after = await getSchemaStatus()
  return {
    attempted: true,
    applied: !carrierConnectionInvitesTablePossiblyMissing(after),
  }
}
