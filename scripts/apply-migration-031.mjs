import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { fileURLToPath } from 'url'
import { getDatabaseConnectionString, getPgClientConfig } from '../lib/pg-connection.mjs'
import { getPgSslConfig } from '../lib/pg-ssl.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')
const envPath = path.join(projectRoot, '.env.local')

function loadMigrationFromManifest(filename) {
  return fs
    .readFileSync(path.join(projectRoot, 'supabase', 'migrations', filename), 'utf8')
    .trim()
}

const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/\s+#.*$/, '').trim()]
    })
)

const connectionString = getDatabaseConnectionString(env)
if (!connectionString) {
  console.error('Set DATABASE_URL or SUPABASE_DB_PASSWORD in .env.local')
  process.exit(1)
}

const sql = loadMigrationFromManifest('031_team_member_profiles_permissions.sql')

const client = new pg.Client(getPgClientConfig(connectionString, getPgSslConfig()))
await client.connect()

try {
  await client.query(sql)
  console.log('Migration 031 (team_member_profiles.permissions) applied successfully.')
} finally {
  await client.end()
}