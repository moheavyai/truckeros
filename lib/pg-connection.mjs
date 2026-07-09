/**
 * Shared Postgres connection string resolution for db-migrate and CLI scripts.
 */

/** Max time (ms) to wait when opening a new Postgres connection. */
export const PG_CONNECTION_TIMEOUT_MS = 10_000

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function getDatabaseConnectionString(env = process.env) {
  if (env.DATABASE_URL) {
    return env.DATABASE_URL
  }

  const password = env.SUPABASE_DB_PASSWORD
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  if (!password || !supabaseUrl) {
    return null
  }

  const ref = supabaseUrl.replace('https://', '').split('.')[0]
  const encoded = encodeURIComponent(password)
  return `postgresql://postgres:${encoded}@db.${ref}.supabase.co:5432/postgres`
}

/**
 * @param {string} connectionString
 * @param {{ rejectUnauthorized: boolean } | false} ssl
 */
export function getPgClientConfig(connectionString, ssl) {
  return {
    connectionString,
    ssl,
    connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
  }
}