/**
 * Apply migration 035 (carrier_connection_invites table + RLS/RPCs) when
 * DATABASE_URL or SUPABASE_DB_PASSWORD is set in .env.local.
 *
 * Always re-applies the full 035 file (idempotent): table, indexes, RLS,
 * protect trigger, accept/preview RPCs, privileged-column guard updates.
 *
 * IMPORTANT: Full 035 CREATE OR REPLACE restores pre-Phase-1 accept/manage RPCs
 * (Owner/Admin/Permit Clerk). Immediately re-applies PE migrations 038–041 so
 * inviter eligibility stays Permit Clerk only and PE triggers remain in place.
 *
 * Idempotent: safe to re-run if the table is missing or PostgREST schema cache
 * is stale (ends with NOTIFY pgrst, 'reload schema').
 *
 * USDOT unique index is non-fatal inside 035 (duplicate data only WARNs).
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { getDatabaseConnectionString, getPgClientConfig } from '../lib/pg-connection.mjs'
import { getPgSslConfig } from '../lib/pg-ssl.mjs'
import { assertAcceptRpcPermitClerkOnly } from '../lib/migration-schema-heuristics.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')
const envPath = path.join(projectRoot, '.env.local')

const POSTGREST_VERIFY_ATTEMPTS = 3
const POSTGREST_VERIFY_DELAY_MS = 500

/** PE migrations that restore Clerk-only inviter after 035 overwrites RPCs. */
const PE_FOLLOWUP_MIGRATIONS = [
  '038_phase1_self_clerk_pe_and_accept_clerk.sql',
  '039_phase1_self_clerk_insert_block.sql',
  '040_phase1_team_invite_self_clerk_update.sql',
  '041_phase1_team_invite_self_clerk_session_match.sql',
]

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
        const raw = l.slice(i + 1).trim()
        const value = raw.replace(/\s+#.*$/, '').trim()
        return [l.slice(0, i).trim(), value]
      })
  )
}

function loadMigrationFromManifest(filename) {
  return fs
    .readFileSync(path.join(projectRoot, 'supabase', 'migrations', filename), 'utf8')
    .trim()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * PostgREST schema cache can lag briefly after NOTIFY; retry before failing.
 */
async function verifyCarrierConnectionInvitesWithRetry(admin) {
  let lastError = null
  for (let attempt = 1; attempt <= POSTGREST_VERIFY_ATTEMPTS; attempt++) {
    const { error } = await admin
      .from('carrier_connection_invites')
      .select('invite_token, status, company_name, organization_id, invite_email')
      .limit(1)

    if (!error) {
      return { ok: true, attempts: attempt }
    }

    lastError = error
    if (attempt < POSTGREST_VERIFY_ATTEMPTS) {
      console.warn(
        `PostgREST verify attempt ${attempt}/${POSTGREST_VERIFY_ATTEMPTS} failed; retrying in ${POSTGREST_VERIFY_DELAY_MS}ms…`,
        error.message
      )
      await sleep(POSTGREST_VERIFY_DELAY_MS)
    }
  }
  return { ok: false, attempts: POSTGREST_VERIFY_ATTEMPTS, error: lastError }
}

const env = loadEnv()

const connectionString = getDatabaseConnectionString(env)
if (!connectionString) {
  console.error('Set DATABASE_URL or SUPABASE_DB_PASSWORD in .env.local')
  process.exit(1)
}

const sql = loadMigrationFromManifest('035_carrier_connection_invites.sql')
const peSqls = PE_FOLLOWUP_MIGRATIONS.map(loadMigrationFromManifest)

const client = new pg.Client(getPgClientConfig(connectionString, getPgSslConfig()))
await client.connect()

try {
  // Full 035 always — recreates functions/policies even when table already exists.
  await client.query(sql)
  // Re-apply Phase 1 PE so accept/manage RPCs are not left on Owner/Admin allowlist.
  for (const peSql of peSqls) {
    await client.query(peSql)
  }
  console.log(
    'Re-applied PE migrations 038-041 after 035 (accept inviter remains Permit Clerk only).'
  )
  // Belt-and-suspenders: migrations end with NOTIFY; send again after chain.
  await client.query(`NOTIFY pgrst, 'reload schema'`)
  console.log('Migration 035 (carrier_connection_invites) + PE follow-up applied successfully.')

  const peOk = await assertAcceptRpcPermitClerkOnly(client)
  if (!peOk) {
    process.exit(1)
  }
} finally {
  await client.end()
}

// Verify via service role when available (same path Carriers page / PostgREST uses).
if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
  const result = await verifyCarrierConnectionInvitesWithRetry(admin)

  if (!result.ok) {
    console.error('Post-apply schema check failed after retries:', result.error?.message)
    console.error('If the table exists in Postgres, wait a moment or re-run NOTIFY pgrst.')
    process.exit(1)
  }
  console.log(
    `Schema check: carrier_connection_invites ok (attempt ${result.attempts}/${POSTGREST_VERIFY_ATTEMPTS})`
  )
} else {
  console.log(
    'Skipped PostgREST verify (set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).'
  )
}
