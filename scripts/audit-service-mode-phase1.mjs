/**
 * Pre-flight audit for Phase 1 Service Mode gates.
 *
 * Lists users/memberships that will lose Service Mode chrome when eligibility
 * narrows to Permit Clerk only (Owners/Admins multi-org, primary_owner/created
 * access paths, etc.). Also lists who keeps SM (Permit Clerk memberships),
 * connection-invite inviters, and pending link requests.
 *
 * Usage (requires DATABASE_URL or SUPABASE_DB_PASSWORD in .env.local):
 *   node scripts/audit-service-mode-phase1.mjs
 *
 * Exit 0 always when the query succeeds (ops awareness, not a gate).
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
  if (!fs.existsSync(envPath)) {
    console.error('Missing .env.local — set DATABASE_URL or SUPABASE_DB_PASSWORD')
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

/** Run each query separately (pg v8 multi-statement only returns last result). */
const AUDIT_QUERIES = [
  {
    bucket: 'lose_sm_non_clerk_multi_org',
    sql: `
SELECT
  'lose_sm_non_clerk_multi_org' AS audit_bucket,
  om.user_id::text,
  om.organization_id::text,
  om.role,
  om.is_primary_owner,
  (SELECT count(*) FROM organization_memberships om2 WHERE om2.user_id = om.user_id) AS membership_count
FROM organization_memberships om
WHERE om.role IS DISTINCT FROM 'Permit Clerk'
  AND (SELECT count(*) FROM organization_memberships om2 WHERE om2.user_id = om.user_id) > 1
ORDER BY om.user_id, om.organization_id
`,
  },
  {
    bucket: 'keep_sm_permit_clerk',
    sql: `
SELECT
  'keep_sm_permit_clerk' AS audit_bucket,
  om.user_id::text,
  om.organization_id::text,
  om.role,
  om.is_primary_owner
FROM organization_memberships om
WHERE om.role = 'Permit Clerk'
ORDER BY om.user_id, om.organization_id
`,
  },
  {
    bucket: 'connection_invite_inviter',
    sql: `
SELECT
  'connection_invite_inviter' AS audit_bucket,
  invited_by_user_id::text AS user_id,
  count(*)::text AS invite_count,
  count(*) FILTER (WHERE status = 'pending')::text AS pending_count
FROM carrier_connection_invites
GROUP BY invited_by_user_id
ORDER BY invited_by_user_id
`,
  },
  {
    bucket: 'pending_link_request',
    sql: `
SELECT
  'pending_link_request' AS audit_bucket,
  id::text AS request_id,
  from_user_id::text AS user_id,
  coalesce(to_organization_id::text, '(unresolved)') AS organization_id,
  coalesce(target_usdot, '') AS target_usdot,
  coalesce(target_email, '') AS target_email
FROM carrier_link_requests
WHERE status = 'pending'
ORDER BY created_at DESC NULLS LAST
LIMIT 200
`,
  },
  {
    bucket: 'summary_owner_admin_access',
    sql: `
SELECT
  'summary_owner_admin_access' AS audit_bucket,
  om.user_id::text,
  om.role,
  count(*)::text AS org_count,
  bool_or(om.is_primary_owner)::text AS any_primary_owner
FROM organization_memberships om
WHERE om.role IN ('Owner', 'Admin', 'Owner / Admin')
GROUP BY om.user_id, om.role
HAVING count(*) > 1 OR bool_or(om.is_primary_owner)
ORDER BY om.user_id
`,
  },
]

const env = loadEnv()
const connectionString = getDatabaseConnectionString(env)
if (!connectionString) {
  console.error('Set DATABASE_URL or SUPABASE_DB_PASSWORD in .env.local')
  console.error('')
  console.error('SQL that would run is printed below for manual use:')
  for (const q of AUDIT_QUERIES) {
    console.log(`-- ${q.bucket}`)
    console.log(q.sql)
  }
  process.exit(1)
}

const client = new pg.Client(getPgClientConfig(connectionString, getPgSslConfig()))
await client.connect()

try {
  console.log('=== Phase 1 Service Mode pre-flight audit ===\n')
  for (const q of AUDIT_QUERIES) {
    const { rows } = await client.query(q.sql)
    console.log(`--- ${q.bucket} (${rows.length} row(s)) ---`)
    if (rows.length === 0) {
      console.log('(none)')
    } else {
      console.table(rows)
    }
    console.log('')
  }
  console.log('Done. Share with ops before deploying Phase 1 client gates + migration 037/038.')
} finally {
  await client.end()
}
