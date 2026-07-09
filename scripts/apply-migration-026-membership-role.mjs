/**
 * @deprecated Use scripts/apply-migration-036.mjs (or scripts/apply-migrations.mjs).
 *
 * This script only repaired organization_memberships.role CHECK and diverged from
 * the full role repair (profile user_roles CHECKs + service-mode helper) in
 * supabase/migrations/036_organization_memberships_role_check.sql.
 *
 * Delegates to migration 036 so partial repairs cannot leave member_profiles
 * stuck on the legacy allowlist.
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

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(projectRoot, '.env.local')

console.warn(
  '[deprecated] apply-migration-026-membership-role.mjs → applying 036_organization_memberships_role_check.sql instead.\n' +
    'Prefer: node scripts/apply-migration-036.mjs'
)

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

const sql = fs
  .readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '036_organization_memberships_role_check.sql'),
    'utf8'
  )
  .trim()

const client = new pg.Client(getPgClientConfig(connectionString, getPgSslConfig()))
await client.connect()

try {
  await client.query(sql)
  const { rows } = await client.query(ROLE_CHECK_HEALTH_SQL)
  const health = roleCheckHealthFromRow(rows[0])
  const ok = roleChecksAllowSplitOwner(health)
  console.log('Applied 036 via deprecated 026 wrapper.')
  console.log('Membership CHECK:', health.membershipDef)
  console.log('member_profiles user_roles CHECK:', health.profileDef)
  console.log('Role CHECKs OK:', ok)
  process.exit(ok ? 0 : 1)
} finally {
  await client.end()
}
