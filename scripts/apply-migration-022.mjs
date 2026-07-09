/**
 * Apply migration 022 (profile_change_requests table + RLS) and 023 policies
 * when DATABASE_URL or SUPABASE_DB_PASSWORD is set in .env.local.
 *
 * Idempotent. Ensures update_updated_at_column, applies 022 then 023, ends with
 * NOTIFY pgrst, and verifies via service-role PostgREST.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { getDatabaseConnectionString, getPgClientConfig } from '../lib/pg-connection.mjs'
import { getPgSslConfig } from '../lib/pg-ssl.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')
const envPath = path.join(projectRoot, '.env.local')

const POSTGREST_VERIFY_ATTEMPTS = 3
const POSTGREST_VERIFY_DELAY_MS = 500

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

function loadMigration(filename) {
  return fs
    .readFileSync(path.join(projectRoot, 'supabase', 'migrations', filename), 'utf8')
    .trim()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function verifyProfileChangeRequestsWithRetry(admin) {
  let lastError = null
  for (let attempt = 1; attempt <= POSTGREST_VERIFY_ATTEMPTS; attempt++) {
    const { error } = await admin
      .from('profile_change_requests')
      .select(
        'id, organization_id, requester_user_id, target_user_id, field_key, status'
      )
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

const sql022 = loadMigration('022_profile_change_requests.sql')
// 023: delete-pending + primary-owner WITH CHECK policies (and member_profiles guards).
const sql023 = loadMigration('023_member_profiles_self_service_field_guard.sql')

// Ensure updated_at helper exists (defined in earlier migrations).
const ensureHelper = `
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`

const client = new pg.Client(getPgClientConfig(connectionString, getPgSslConfig()))
await client.connect()

try {
  await client.query(ensureHelper)
  await client.query(sql022)
  await client.query(sql023)
  await client.query(`NOTIFY pgrst, 'reload schema'`)
  console.log(
    'Migration 022 (profile_change_requests) + 023 policies applied successfully.'
  )
} finally {
  await client.end()
}

if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
  const result = await verifyProfileChangeRequestsWithRetry(admin)
  if (!result.ok) {
    console.error('Post-apply schema check failed after retries:', result.error?.message)
    process.exit(1)
  }
  console.log(
    `Schema check: profile_change_requests ok (attempt ${result.attempts}/${POSTGREST_VERIFY_ATTEMPTS})`
  )
} else {
  console.log(
    'Skipped PostgREST verify (set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).'
  )
}
