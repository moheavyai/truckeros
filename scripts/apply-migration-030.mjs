import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { fileURLToPath } from 'url'
import { getDatabaseConnectionString, getPgClientConfig } from '../lib/pg-connection.mjs'
import { getPgSslConfig } from '../lib/pg-ssl.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')
const envPath = path.join(projectRoot, '.env.local')

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

const sql = fs.readFileSync(
  path.join(projectRoot, 'supabase/migrations/030_owner_operator_user_roles.sql'),
  'utf8'
)

const client = new pg.Client(getPgClientConfig(connectionString, getPgSslConfig()))
await client.connect()

try {
  await client.query(sql)

  const { rows: constraintRows } = await client.query(
    `SELECT pg_get_constraintdef(oid) AS def
     FROM pg_constraint
     WHERE conname = 'member_profiles_user_roles_check'`
  )

  const { rows: validRows } = await client.query(
    `SELECT member_profile_user_roles_valid(ARRAY['Owner','Driver']::text[]) AS owner_operator_valid`
  )

  console.log('Migration 030 applied successfully.')
  console.log('Constraint:', constraintRows[0]?.def ?? 'missing')
  console.log('Owner+Driver valid:', validRows[0]?.owner_operator_valid)
} finally {
  await client.end()
}