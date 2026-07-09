/**
 * Shared CLI migration helpers: missing-table PostgREST heuristics and
 * accept_carrier_connection_invite Permit Clerk PE checks.
 *
 * Used by scripts/apply-migrations.mjs and scripts/apply-migration-035.mjs.
 */

/**
 * CLI schema heuristics: only treat as missing when PostgREST/Postgres indicates
 * relation absent or schema-cache miss — not permission-denied / RLS noise.
 *
 * @param {string | null | undefined} message
 * @param {string} table
 * @returns {boolean}
 */
export function isMissingRelationOrSchemaCacheError(message, table) {
  if (!message || message === 'ok') return false
  const m = String(message).toLowerCase()
  // Do not re-apply full migrations on auth / RLS failures.
  if (
    m.includes('permission denied') ||
    m.includes('row-level security') ||
    m.includes('violates row-level') ||
    m.includes('jwt')
  ) {
    return false
  }
  if (m.includes('schema cache')) return true
  if (m.includes('does not exist')) return true
  if (m.includes('could not find the table') && m.includes(String(table).toLowerCase())) {
    return true
  }
  return false
}

/**
 * Pure check on accept_carrier_connection_invite function body text.
 * Clerk-only PE requires `om.role = 'Permit Clerk'` and no legacy Owner/Admin IN list.
 *
 * @param {string} def
 * @returns {{ clerkOnly: boolean, stillOwnerAdmin: boolean, peOk: boolean }}
 */
export function acceptRpcPeStatusFromDef(def) {
  const text = def ?? ''
  const clerkOnly = /om\.role\s*=\s*'Permit Clerk'/.test(text)
  // Legacy inviter allowlist from bare 035 (must be gone after PE re-apply).
  const stillOwnerAdmin = /om\.role\s+IN\s*\(\s*'Owner'/.test(text)
  return {
    clerkOnly,
    stillOwnerAdmin,
    peOk: clerkOnly && !stillOwnerAdmin && text.length > 0,
  }
}

/**
 * Load accept_carrier_connection_invite definition and evaluate PE status.
 *
 * @param {{ query: (sql: string) => Promise<{ rows: Array<{ def?: string }> }> }} client
 */
export async function fetchAcceptRpcPeStatus(client) {
  const { rows } = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'accept_carrier_connection_invite'
    LIMIT 1
  `)
  const def = rows[0]?.def ?? ''
  return { ...acceptRpcPeStatusFromDef(def), hasDef: def.length > 0, def }
}

/**
 * After 035+PE apply: fail if accept RPC is not Permit Clerk-only.
 *
 * @param {{ query: (sql: string) => Promise<{ rows: Array<{ def?: string }> }> }} client
 * @param {{ log?: (msg: string) => void, error?: (msg: string, extra?: unknown) => void }} [opts]
 * @returns {Promise<boolean>} true when PE ok
 */
export async function assertAcceptRpcPermitClerkOnly(client, opts = {}) {
  const log = opts.log ?? console.log.bind(console)
  const error = opts.error ?? console.error.bind(console)
  const peCheck = await fetchAcceptRpcPeStatus(client)
  if (!peCheck.hasDef) {
    error('accept_carrier_connection_invite not found after 035+PE apply.')
    return false
  }
  if (!peCheck.peOk) {
    error('PE regression: accept RPC is not Permit Clerk-only after 035+PE chain.', {
      clerkOnly: peCheck.clerkOnly,
      stillOwnerAdmin: peCheck.stillOwnerAdmin,
    })
    return false
  }
  log('accept RPC inviter Clerk-only: true')
  return true
}
