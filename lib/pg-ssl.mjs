/**
 * Postgres SSL options for Supabase direct connections.
 * Production verifies TLS certificates; development allows self-signed pools.
 */
export function getPgSslConfig() {
  if (process.env.NODE_ENV === 'production') {
    return { rejectUnauthorized: true }
  }
  // Dev/local: Supabase pooler or tunneled Postgres may use certs Node cannot verify.
  return { rejectUnauthorized: false }
}