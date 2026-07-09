/**
 * Apply migration 040 (team_invites self-Clerk PE on UPDATE).
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
const migrationFile = '040_phase1_team_invite_self_clerk_update.sql'

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

  const { rows: triggers } = await client.query(`
    SELECT tgname
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN (
        'trg_no_self_permit_clerk_team_invite',
        'trg_no_self_permit_clerk_team_invite_update'
      )
    ORDER BY tgname
  `)

  const { rows: fn } = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'enforce_no_self_permit_clerk_team_invite'
    LIMIT 1
  `)
  const def = fn[0]?.def ?? ''
  const hasUpdateSkip =
    def.includes("TG_OP = 'UPDATE'") && def.includes('invite_email IS NOT DISTINCT FROM OLD.invite_email')

  console.log('Migration 040 applied successfully.')
  console.log(
    'Triggers present:',
    triggers.map((t) => t.tgname).join(', ') || '(none)'
  )
  console.log('Function handles UPDATE path:', hasUpdateSkip)

  if (triggers.length < 2 || !hasUpdateSkip) {
    console.warn('Verification incomplete.')
    process.exit(1)
  }
  process.exit(0)
} finally {
  await client.end()
}
