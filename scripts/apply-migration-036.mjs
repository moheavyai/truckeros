/**
 * Apply migration 036 (membership + profile role CHECK repair) when DATABASE_URL
 * or SUPABASE_DB_PASSWORD is set in .env.local.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { fileURLToPath } from 'url'
import { getDatabaseConnectionString, getPgClientConfig } from '../lib/pg-connection.mjs'
import { getPgSslConfig } from '../lib/pg-ssl.mjs'
import {
  ROLE_CHECK_HEALTH_SQL,
  roleCheckHealthFromRow,
  roleChecksAllowSplitOwner,
} from '../lib/membership-role-check.mjs'

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

const sql = loadMigrationFromManifest('036_organization_memberships_role_check.sql')

const client = new pg.Client(getPgClientConfig(connectionString, getPgSslConfig()))
await client.connect()

try {
  await client.query(sql)

  const { rows } = await client.query(ROLE_CHECK_HEALTH_SQL)
  const health = roleCheckHealthFromRow(rows[0])
  const ok = roleChecksAllowSplitOwner(health)

  console.log('Migration 036 (memberships + profile role CHECKs) applied successfully.')
  console.log('Membership CHECK:', health.membershipDef ?? '(missing)')
  console.log('member_profiles user_roles CHECK:', health.profileDef ?? '(missing)')
  console.log('Role CHECKs OK:', ok)
  process.exit(ok ? 0 : 1)
} finally {
  await client.end()
}
