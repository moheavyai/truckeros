/**
 * Force-create profile_change_requests + carrier_connection_invites and
 * hard-reload PostgREST schema cache so the API recognizes them.
 *
 * Usage: node scripts/force-create-missing-tables.mjs
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
const migrationsDir = path.join(projectRoot, 'supabase', 'migrations')
const envPath = path.join(projectRoot, '.env.local')

const TABLES = ['profile_change_requests', 'carrier_connection_invites']
const VERIFY_ATTEMPTS = 8
const VERIFY_DELAY_MS = 750

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function readMigration(name) {
  return fs.readFileSync(path.join(migrationsDir, name), 'utf8').trim()
}

const env = loadEnv()
const connectionString = getDatabaseConnectionString(env)
if (!connectionString) {
  console.error('Set DATABASE_URL or SUPABASE_DB_PASSWORD in .env.local')
  process.exit(1)
}

const client = new pg.Client(getPgClientConfig(connectionString, getPgSslConfig()))
await client.connect()

const ensureHelper = `
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`

// Explicit grants so PostgREST roles can see the tables (Supabase roles).
const grantSql = `
DO $$
BEGIN
  -- Ensure API roles exist (Supabase); no-op if not
  NULL;
END $$;

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

GRANT ALL ON TABLE public.profile_change_requests TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.carrier_connection_invites TO postgres, anon, authenticated, service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;

-- Authenticator is the login role for PostgREST on some setups
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    GRANT USAGE ON SCHEMA public TO authenticator;
    GRANT ALL ON TABLE public.profile_change_requests TO authenticator;
    GRANT ALL ON TABLE public.carrier_connection_invites TO authenticator;
  END IF;
END $$;
`

// PE follow-ups after 035 so we do not regress Phase 1
const peFollowups = [
  '038_phase1_self_clerk_pe_and_accept_clerk.sql',
  '039_phase1_self_clerk_insert_block.sql',
  '040_phase1_team_invite_self_clerk_update.sql',
  '041_phase1_team_invite_self_clerk_session_match.sql',
]

console.log('Connecting and force-creating tables…')

try {
  await client.query(ensureHelper)

  console.log('→ 022_profile_change_requests.sql')
  await client.query(readMigration('022_profile_change_requests.sql'))

  console.log('→ 023_member_profiles_self_service_field_guard.sql (PCR policies)')
  await client.query(readMigration('023_member_profiles_self_service_field_guard.sql'))

  console.log('→ 035_carrier_connection_invites.sql')
  await client.query(readMigration('035_carrier_connection_invites.sql'))

  for (const pe of peFollowups) {
    const pePath = path.join(migrationsDir, pe)
    if (fs.existsSync(pePath)) {
      console.log(`→ ${pe} (PE restore after 035)`)
      await client.query(fs.readFileSync(pePath, 'utf8'))
    }
  }

  console.log('→ GRANT privileges for API roles')
  await client.query(grantSql)

  // Hard schema reload signals (multiple for stubborn caches)
  console.log('→ NOTIFY pgrst reload schema (x3)')
  for (let i = 0; i < 3; i++) {
    await client.query(`NOTIFY pgrst, 'reload schema'`)
    await client.query(`NOTIFY pgrst, 'reload config'`)
    await sleep(200)
  }

  // Confirm tables exist in Postgres
  const { rows } = await client.query(
    `
    SELECT relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = ANY($1::text[])
    ORDER BY 1
  `,
    [TABLES]
  )
  console.log(
    'Postgres tables present:',
    rows.map((r) => r.relname).join(', ') || '(none)'
  )
  if (rows.length !== TABLES.length) {
    throw new Error(
      `Expected ${TABLES.length} tables in public, found: ${rows.map((r) => r.relname).join(', ')}`
    )
  }
} finally {
  await client.end()
}

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for PostgREST verify')
  process.exit(1)
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// Also try REST OpenAPI root to force cache touch
const restUrl = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/'
console.log('→ Probing REST root:', restUrl)

async function verifyTable(table) {
  let last = null
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
    const { error } = await admin.from(table).select('*').limit(1)
    if (!error) return { ok: true, attempts: attempt }
    last = error
    console.warn(
      `  ${table} attempt ${attempt}/${VERIFY_ATTEMPTS}: ${error.message}`
    )
    // Re-send NOTIFY between retries via a short reconnect
    if (attempt < VERIFY_ATTEMPTS) {
      const c = new pg.Client(getPgClientConfig(connectionString, getPgSslConfig()))
      await c.connect()
      try {
        await c.query(`NOTIFY pgrst, 'reload schema'`)
      } finally {
        await c.end()
      }
      await sleep(VERIFY_DELAY_MS)
    }
  }
  return { ok: false, error: last }
}

let failed = false
for (const t of TABLES) {
  const result = await verifyTable(t)
  if (result.ok) {
    console.log(`✓ PostgREST recognizes ${t} (attempt ${result.attempts}/${VERIFY_ATTEMPTS})`)
  } else {
    failed = true
    console.error(`✗ PostgREST still fails for ${t}:`, result.error?.message)
  }
}

// Anon key check (what browsers often use before JWT)
if (env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  })
  for (const t of TABLES) {
    const { error } = await anon.from(t).select('*').limit(1)
    // RLS may block rows but schema should exist — PGRST205 = not in schema cache
    const msg = error?.message || ''
    if (msg.includes('schema cache') || msg.includes('Could not find the table')) {
      failed = true
      console.error(`✗ Anon key still missing ${t} from schema cache:`, msg)
    } else {
      console.log(
        `✓ Anon key schema sees ${t} (${error ? 'RLS/empty: ' + msg.slice(0, 80) : 'ok'})`
      )
    }
  }
}

if (failed) {
  console.error('\nFAILED: schema cache still missing tables.')
  console.error('If using hosted Supabase, also try Project Settings → API → Reload schema,')
  console.error('or wait 10–30s and re-run this script.')
  process.exit(1)
}

console.log('\nSUCCESS: both tables exist and are recognized by PostgREST.')
