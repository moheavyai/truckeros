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

const sql = loadMigrationFromManifest('032_owner_bootstrap_membership_rls.sql')

const client = new pg.Client(getPgClientConfig(connectionString, getPgSslConfig()))
await client.connect()

try {
  await client.query(sql)

  const { rows } = await client.query(
    `SELECT policyname
     FROM pg_policies
     WHERE tablename = 'organization_memberships'
       AND policyname = 'Org creators can insert primary owner membership'`
  )

  console.log('Migration 032 (owner bootstrap membership RLS) applied successfully.')
  console.log('Policy present:', rows.length === 1)
} finally {
  await client.end()
}