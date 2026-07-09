/**
 * Apply migration 037 (Phase 1b: restore membership SELECT + narrow SM helper
 * to Permit Clerk) when DATABASE_URL or SUPABASE_DB_PASSWORD is set in .env.local.
 *
 * Idempotent: safe to re-run (DROP POLICY IF EXISTS + CREATE OR REPLACE + NOTIFY).
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { fileURLToPath } from 'url'
import { getDatabaseConnectionString, getPgClientConfig } from '../lib/pg-connection.mjs'
import { getPgSslConfig } from '../lib/pg-ssl.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')
const envPath = path.join(projectRoot, '.env.local')
const migrationFile = '037_phase1b_membership_select_and_sm_clerk.sql'

function loadEnv() {
  if (!fs.existsSync(envPath)) {
    console.error('Missing .env.local')
    process.exit(1)
  }
  return Object.fromEntries(
    fs
      .readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/\s+#.*$/, '').trim()]
      })
  )
}

const env = loadEnv()
const connectionString = getDatabaseConnectionString(env)
if (!connectionString) {
  console.error('Set DATABASE_URL or SUPABASE_DB_PASSWORD in .env.local')
  process.exit(1)
}

const sql = fs
  .readFileSync(path.join(projectRoot, 'supabase', 'migrations', migrationFile), 'utf8')
  .trim()

const client = new pg.Client(getPgClientConfig(connectionString, getPgSslConfig()))
await client.connect()

try {
  await client.query(sql)

  const { rows } = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'auth_user_service_mode_org_ids'
    LIMIT 1
  `)
  const def = rows[0]?.def ?? ''
  const clerkOnly =
    def.includes("role = 'Permit Clerk'") || def.includes("role = 'Permit Clerk'::text")
  const stillOwnerAdmin =
    /role\s+IN\s*\([^)]*'Owner'[^)]*\)/i.test(def) ||
    /'Owner',\s*'Admin'/.test(def) ||
    /'Owner'.*'Admin'/.test(def)

  console.log('Migration 037 applied successfully.')
  console.log('auth_user_service_mode_org_ids Permit Clerk only:', clerkOnly && !stillOwnerAdmin)
  if (!clerkOnly || stillOwnerAdmin) {
    console.warn('Warning: helper definition may still include non-Clerk roles:')
    console.warn(def.slice(0, 400))
    process.exit(1)
  }
  process.exit(0)
} finally {
  await client.end()
}
