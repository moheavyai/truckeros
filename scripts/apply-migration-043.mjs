/**
 * Apply migration 043 (permit_requests.border_crossings + highways).
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
const migrationFile = '043_permit_request_border_crossings.sql'

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
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'permit_requests'
    ORDER BY ordinal_position
  `)
  const cols = rows.map((r) => r.column_name)
  const required = ['border_crossings', 'highways']
  const missing = required.filter((c) => !cols.includes(c))

  console.log('Migration 043 applied successfully.')
  console.log('permit_requests columns include:', required.map((c) => `${c}=${cols.includes(c)}`).join(', '))

  if (missing.length > 0) {
    console.warn('Missing columns:', missing.join(', '))
    process.exit(1)
  }
  process.exit(0)
} finally {
  await client.end()
}
