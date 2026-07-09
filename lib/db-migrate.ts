/**
 * Run idempotent migration SQL against Postgres when DATABASE_URL or
 * SUPABASE_DB_PASSWORD is configured (server-only).
 */

import {
  getDatabaseConnectionString,
  getPgClientConfig,
  PG_CONNECTION_TIMEOUT_MS,
} from './pg-connection.mjs'

export { getDatabaseConnectionString, getPgClientConfig, PG_CONNECTION_TIMEOUT_MS }

/** Postgres SSL: verify certs in production; allow self-signed only in development. */
export function getPgSslConfig(): { rejectUnauthorized: boolean } {
  if (process.env.NODE_ENV === 'production') {
    return { rejectUnauthorized: true }
  }
  // Dev/local: pooler or tunneled Postgres may present certs Node cannot verify.
  return { rejectUnauthorized: false }
}

export async function runMigrationSql(sql: string): Promise<void> {
  const connectionString = getDatabaseConnectionString()
  if (!connectionString) {
    throw new Error(
      'No database connection available. Set DATABASE_URL or SUPABASE_DB_PASSWORD in .env.local.'
    )
  }

  const pg = await import('pg')
  // Idempotent IF NOT EXISTS DDL auto-commits per statement in Postgres; wrapping
  // statements in a transaction would not make multi-statement DDL atomic.
  const client = new pg.default.Client(
    getPgClientConfig(connectionString, getPgSslConfig())
  )

  await client.connect()
  try {
    await client.query(sql)
  } finally {
    await client.end()
  }
}