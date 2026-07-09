/**
 * Apply migration 041 (team_invites self-Clerk PE matches session user).
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
const migrationFile = '041_phase1_team_invite_self_clerk_session_match.sql'

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

  const { rows: fn } = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'enforce_no_self_permit_clerk_team_invite'
    LIMIT 1
  `)
  const def = fn[0]?.def ?? ''

  // Must NOT gate only on invited_by = auth.uid(); must match session contacts.
  const gatesOnInvitedByOnly =
    /invited_by_user_id\s+IS\s+DISTINCT\s+FROM\s+auth\.uid\(\)[\s\S]{0,80}RETURN NEW/i.test(def)
  const sessionMatch =
    def.includes('auth.uid()') &&
    def.includes("Cannot invite yourself as Permit Clerk") &&
    /FROM auth\.users/i.test(def)

  console.log('Migration 041 applied successfully.')
  console.log('Session-based contact match present:', sessionMatch)
  console.log('No invited_by-only early return gate:', !gatesOnInvitedByOnly)

  if (!sessionMatch || gatesOnInvitedByOnly) {
    console.warn('Verification incomplete — check function body:')
    console.warn(def.slice(0, 600))
    process.exit(1)
  }
  process.exit(0)
} finally {
  await client.end()
}
