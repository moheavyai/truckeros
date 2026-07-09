/**
 * Apply migration 023 (member_profiles field guards + profile_change_requests policies).
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

function loadEnv() {
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

const sql = fs.readFileSync(
  path.join(projectRoot, 'supabase', 'migrations', '023_member_profiles_self_service_field_guard.sql'),
  'utf8'
)

const client = new pg.Client(getPgClientConfig(connectionString, getPgSslConfig()))
await client.connect()
try {
  await client.query(sql)
  await client.query(`NOTIFY pgrst, 'reload schema'`)
  console.log('Migration 023 applied successfully.')
} finally {
  await client.end()
}
