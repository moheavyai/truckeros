/**
 * Apply pending migrations from lib/migration-manifest.json when DATABASE_URL or
 * SUPABASE_DB_PASSWORD is set in .env.local. Verifies schema via service role
 * and organization_memberships.role CHECK (migration 036).
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { getDatabaseConnectionString, getPgClientConfig } from '../lib/pg-connection.mjs'
import { getPgSslConfig } from '../lib/pg-ssl.mjs'
import {
  ROLE_CHECK_HEALTH_SQL,
  roleCheckHealthFromRow,
  roleChecksAllowSplitOwner,
} from '../lib/membership-role-check.mjs'
import {
  assertAcceptRpcPermitClerkOnly,
  isMissingRelationOrSchemaCacheError,
} from '../lib/migration-schema-heuristics.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')
const envPath = path.join(projectRoot, '.env.local')

const POSTGREST_VERIFY_ATTEMPTS = 3
const POSTGREST_VERIFY_DELAY_MS = 500

/** PE migrations re-applied after targeted 035 so accept inviter stays Clerk-only. */
const PE_FOLLOWUP_MIGRATION_FILES = [
  '038_phase1_self_clerk_pe_and_accept_clerk.sql',
  '039_phase1_self_clerk_insert_block.sql',
  '040_phase1_team_invite_self_clerk_update.sql',
  '041_phase1_team_invite_self_clerk_session_match.sql',
]

function loadEnv() {
  if (!fs.existsSync(envPath)) {
    console.error('Missing .env.local — create it from .env.local.example and set:')
    console.error('  NEXT_PUBLIC_SUPABASE_URL')
    console.error('  NEXT_PUBLIC_SUPABASE_ANON_KEY')
    console.error('  SUPABASE_SERVICE_ROLE_KEY')
    console.error('  SUPABASE_DB_PASSWORD (or DATABASE_URL) for live migration apply')
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

function loadManifestMigrations() {
  const manifestPath = path.join(projectRoot, 'lib', 'migration-manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const migrationsDir = path.join(projectRoot, 'supabase', 'migrations')

  return manifest.migrations.map((name) => ({
    name,
    sql: fs.readFileSync(path.join(migrationsDir, name), 'utf8'),
  }))
}

function loadMigrationSql() {
  return loadManifestMigrations()
    .map((entry) => entry.sql)
    .join('\n\n')
}

function loadMigrationSqlByName(filename) {
  const entry = loadManifestMigrations().find((migration) => migration.name === filename)
  if (!entry) {
    throw new Error(`Migration not found in manifest: ${filename}`)
  }
  return entry.sql.trim()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function checkSchema(admin) {
  const checks = [
    ['equipment_profiles', ['license_plate', 'license_plate_state']],
    ['rig_configurations', ['is_default']],
    ['permit_requests', ['origin_query', 'destination_query', 'drops']],
    ['member_profiles', ['company_name', 'user_roles', 'organization_id', 'is_primary_owner']],
    ['team_member_profiles', ['organization_id', 'driver_full_name', 'user_roles', 'permissions']],
    ['organizations', ['name', 'usdot_number', 'created_by_user_id']],
    ['organization_memberships', ['organization_id', 'user_id', 'role']],
    ['carrier_link_requests', ['from_user_id', 'status', 'target_usdot']],
    ['team_invites', ['organization_id', 'invite_token', 'status']],
    [
      'profile_change_requests',
      ['id', 'organization_id', 'requester_user_id', 'target_user_id', 'field_key', 'status'],
    ],
    [
      'carrier_connection_invites',
      ['invite_token', 'status', 'company_name', 'organization_id', 'invite_email'],
    ],
  ]
  const results = {}
  for (const [table, cols] of checks) {
    const { error } = await admin.from(table).select(cols.join(', ')).limit(1)
    results[`${table}`] = error ? error.message : 'ok'
  }
  return results
}

/**
 * Retry PostgREST schema checks after NOTIFY — cache lag can false-fail once.
 */
async function checkSchemaWithRetry(admin) {
  let last = null
  for (let attempt = 1; attempt <= POSTGREST_VERIFY_ATTEMPTS; attempt++) {
    last = await checkSchema(admin)
    if (Object.values(last).every((v) => v === 'ok')) {
      return { ok: true, results: last, attempts: attempt }
    }
    if (attempt < POSTGREST_VERIFY_ATTEMPTS) {
      console.warn(
        `PostgREST verify attempt ${attempt}/${POSTGREST_VERIFY_ATTEMPTS} incomplete; retrying in ${POSTGREST_VERIFY_DELAY_MS}ms…`,
        last
      )
      await sleep(POSTGREST_VERIFY_DELAY_MS)
    }
  }
  return { ok: false, results: last, attempts: POSTGREST_VERIFY_ATTEMPTS }
}

function isTeamMemberPermissionsPossiblyMissing(schemaResults) {
  const message = schemaResults.team_member_profiles
  if (message === 'ok') return false
  // Column-level: permissions missing or schema cache for this select.
  if (message.includes('permissions')) return true
  return isMissingRelationOrSchemaCacheError(message, 'team_member_profiles')
}

function isTeamInvitesTablePossiblyMissing(schemaResults) {
  const message = schemaResults.team_invites
  if (message === 'ok') return false
  return isMissingRelationOrSchemaCacheError(message, 'team_invites')
}

function isProfileChangeRequestsTablePossiblyMissing(schemaResults) {
  const message = schemaResults.profile_change_requests
  if (message === 'ok') return false
  return isMissingRelationOrSchemaCacheError(message, 'profile_change_requests')
}

function isCarrierConnectionInvitesTablePossiblyMissing(schemaResults) {
  const message = schemaResults.carrier_connection_invites
  if (message === 'ok') return false
  return isMissingRelationOrSchemaCacheError(message, 'carrier_connection_invites')
}

async function fetchRoleCheckHealth(client) {
  const { rows } = await client.query(ROLE_CHECK_HEALTH_SQL)
  return roleCheckHealthFromRow(rows[0])
}

async function isMembershipRoleCheckOk(client) {
  const health = await fetchRoleCheckHealth(client)
  return roleChecksAllowSplitOwner(health)
}

async function applyPermissionsFixIfNeeded(client, admin, permissionsFixSql) {
  const status = await checkSchema(admin)
  if (!isTeamMemberPermissionsPossiblyMissing(status)) {
    return false
  }

  await client.query(permissionsFixSql)
  console.log('Applied targeted team_member_profiles.permissions migration.')
  return true
}

async function applyTeamInvitesFixIfNeeded(client, admin, teamInvitesFixSql) {
  const status = await checkSchema(admin)
  if (!isTeamInvitesTablePossiblyMissing(status)) {
    return false
  }

  await client.query(teamInvitesFixSql)
  console.log('Applied targeted team_invites table migration.')
  return true
}

async function applyProfileChangeRequestsFixIfNeeded(
  client,
  admin,
  profileChangeRequestsFixSql,
  profileChangeRequestsPoliciesSql
) {
  const status = await checkSchema(admin)
  if (!isProfileChangeRequestsTablePossiblyMissing(status)) {
    return false
  }

  // 022 depends on update_updated_at_column (defined in earlier migrations).
  await client.query(`
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`)
  await client.query(profileChangeRequestsFixSql)
  // 023 policies (delete pending + primary-owner WITH CHECK) — idempotent.
  if (profileChangeRequestsPoliciesSql) {
    await client.query(profileChangeRequestsPoliciesSql)
  }
  // Migration 022 ends with NOTIFY; ensure PostgREST reloads after targeted apply.
  await client.query(`NOTIFY pgrst, 'reload schema'`)
  console.log('Applied targeted profile_change_requests migration (022 + 023 policies).')
  return true
}

async function applyCarrierConnectionInvitesFixIfNeeded(
  client,
  admin,
  carrierConnectionInvitesFixSql,
  peFollowupSqls = []
) {
  const status = await checkSchema(admin)
  if (!isCarrierConnectionInvitesTablePossiblyMissing(status)) {
    return false
  }

  await client.query(carrierConnectionInvitesFixSql)
  // 035 CREATE OR REPLACE restores pre-PE accept RPCs — re-apply 038–041.
  for (const peSql of peFollowupSqls) {
    await client.query(peSql)
  }
  if (peFollowupSqls.length > 0) {
    console.log('Re-applied PE migrations 038-041 after targeted 035.')
    // Columns alone can look ok if PE mid-chain failed — fail hard on Owner/Admin accept.
    const peOk = await assertAcceptRpcPermitClerkOnly(client)
    if (!peOk) {
      throw new Error(
        'PE regression after targeted 035: accept_carrier_connection_invite is not Permit Clerk-only'
      )
    }
  }
  // Migration 035 ends with NOTIFY; ensure PostgREST reloads after targeted apply.
  await client.query(`NOTIFY pgrst, 'reload schema'`)
  console.log(
    'Applied targeted carrier_connection_invites migration (035' +
      (peFollowupSqls.length > 0 ? ' + PE 038-041' : '') +
      ').'
  )
  return true
}

async function applyRoleCheckFixIfNeeded(client, roleCheckFixSql) {
  const health = await fetchRoleCheckHealth(client)
  if (roleChecksAllowSplitOwner(health)) {
    return false
  }

  // Targeted 036 requires tables; greenfield (no memberships table) needs full apply.
  if (!health.membershipsTableExists) {
    console.log('organization_memberships missing — skip targeted 036 (needs full migration).')
    return false
  }

  await client.query(roleCheckFixSql)
  console.log('Applied targeted role CHECK migration (036: memberships + profile user_roles).')
  const after = await fetchRoleCheckHealth(client)
  if (!roleChecksAllowSplitOwner(after)) {
    console.warn('Role CHECKs still not OK after 036:', {
      membershipDef: after.membershipDef,
      profileDef: after.profileDef,
    })
  }
  return true
}

async function checkPrivilegedColumnGuards(client) {
  const { rows } = await client.query(
    `SELECT tgname
     FROM pg_trigger
     WHERE tgname = 'enforce_member_profile_privileged_columns'`
  )
  return rows.length > 0 ? 'ok' : 'missing enforce_member_profile_privileged_columns trigger'
}

const env = loadEnv()

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required Supabase env vars in .env.local:')
  if (!env.NEXT_PUBLIC_SUPABASE_URL) console.error('  NEXT_PUBLIC_SUPABASE_URL')
  if (!env.SUPABASE_SERVICE_ROLE_KEY) console.error('  SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const before = await checkSchema(admin)
console.log('Before:', before)

const columnsOk = Object.values(before).every((v) => v === 'ok')

const connectionString = getDatabaseConnectionString(env)
if (!connectionString) {
  if (columnsOk) {
    console.log(
      'Schema columns complete (could not verify role CHECK without DATABASE_URL / SUPABASE_DB_PASSWORD).'
    )
    process.exit(0)
  }
  console.error('Set DATABASE_URL or SUPABASE_DB_PASSWORD in .env.local to apply migrations.')
  process.exit(1)
}

const sql = loadMigrationSql()
const permissionsFixSql = loadMigrationSqlByName('031_team_member_profiles_permissions.sql')
const teamInvitesFixSql = loadMigrationSqlByName('033_team_invites_table.sql')
const profileChangeRequestsFixSql = loadMigrationSqlByName('022_profile_change_requests.sql')
const profileChangeRequestsPoliciesSql = loadMigrationSqlByName(
  '023_member_profiles_self_service_field_guard.sql'
)
const carrierConnectionInvitesFixSql = loadMigrationSqlByName(
  '035_carrier_connection_invites.sql'
)
const peFollowupSqls = PE_FOLLOWUP_MIGRATION_FILES.map(loadMigrationSqlByName)
const roleCheckFixSql = loadMigrationSqlByName('036_organization_memberships_role_check.sql')

const client = new pg.Client(getPgClientConfig(connectionString, getPgSslConfig()))
await client.connect()
try {
  const healthBefore = await fetchRoleCheckHealth(client)
  const roleCheckOkBefore = roleChecksAllowSplitOwner(healthBefore)
  console.log('Role CHECK health:', {
    ok: roleCheckOkBefore,
    membershipsTableExists: healthBefore.membershipsTableExists,
    memberProfilesTableExists: healthBefore.memberProfilesTableExists,
    membershipDef: healthBefore.membershipDef
      ? `${String(healthBefore.membershipDef).slice(0, 80)}…`
      : '(missing)',
    profileDef: healthBefore.profileDef
      ? `${String(healthBefore.profileDef).slice(0, 80)}…`
      : '(missing)',
  })

  if (columnsOk && roleCheckOkBefore) {
    console.log('Schema already complete (columns + membership/profile role CHECKs).')
    process.exit(0)
  }

  // Columns look fine but legacy/missing role CHECKs — apply 036 only when tables exist.
  if (columnsOk && !roleCheckOkBefore && healthBefore.membershipsTableExists) {
    console.log('Columns complete but role CHECKs legacy/missing; applying 036…')
    await applyRoleCheckFixIfNeeded(client, roleCheckFixSql)
    const roleCheckOkAfter = await isMembershipRoleCheckOk(client)
    console.log('Role CHECK OK after 036:', roleCheckOkAfter)
    process.exit(roleCheckOkAfter ? 0 : 1)
  }

  // Only profile_change_requests missing — apply 022 (+ 023 policies) without full SQL.
  const onlyProfileChangeRequestsMissing =
    !columnsOk &&
    roleCheckOkBefore &&
    Object.entries(before).every(
      ([table, status]) => table === 'profile_change_requests' || status === 'ok'
    ) &&
    isProfileChangeRequestsTablePossiblyMissing(before)

  if (onlyProfileChangeRequestsMissing) {
    console.log('Only profile_change_requests missing; applying targeted 022…')
    await applyProfileChangeRequestsFixIfNeeded(
      client,
      admin,
      profileChangeRequestsFixSql,
      profileChangeRequestsPoliciesSql
    )
    const verify = await checkSchemaWithRetry(admin)
    console.log('After targeted 022:', verify.results)
    process.exit(verify.ok ? 0 : 1)
  }

  // Only carrier_connection_invites missing — apply 035 + PE without full consolidated SQL.
  const onlyCarrierConnectionInvitesMissing =
    !columnsOk &&
    roleCheckOkBefore &&
    Object.entries(before).every(
      ([table, status]) => table === 'carrier_connection_invites' || status === 'ok'
    ) &&
    isCarrierConnectionInvitesTablePossiblyMissing(before)

  if (onlyCarrierConnectionInvitesMissing) {
    console.log('Only carrier_connection_invites missing; applying targeted 035…')
    await applyCarrierConnectionInvitesFixIfNeeded(
      client,
      admin,
      carrierConnectionInvitesFixSql,
      peFollowupSqls
    )
    const verify = await checkSchemaWithRetry(admin)
    console.log('After targeted 035:', verify.results)
    process.exit(verify.ok ? 0 : 1)
  }

  try {
    await client.query(sql)
    console.log('Migration SQL applied.')
    await applyPermissionsFixIfNeeded(client, admin, permissionsFixSql)
    await applyTeamInvitesFixIfNeeded(client, admin, teamInvitesFixSql)
    await applyProfileChangeRequestsFixIfNeeded(
      client,
      admin,
      profileChangeRequestsFixSql,
      profileChangeRequestsPoliciesSql
    )
    await applyCarrierConnectionInvitesFixIfNeeded(
      client,
      admin,
      carrierConnectionInvitesFixSql,
      peFollowupSqls
    )
    await applyRoleCheckFixIfNeeded(client, roleCheckFixSql)
  } catch (migrationError) {
    console.warn('Full migration failed; attempting targeted migrations:', migrationError.message)
    // Isolate each fix so one failure (e.g. 035) cannot skip later repairs (036).
    let permissionsApplied = false
    let teamInvitesApplied = false
    let profileChangeRequestsApplied = false
    let carrierConnectionInvitesApplied = false
    let roleCheckApplied = false

    try {
      permissionsApplied = await applyPermissionsFixIfNeeded(
        client,
        admin,
        permissionsFixSql
      )
    } catch (err) {
      console.warn('Targeted 031 (permissions) failed:', err.message)
    }

    try {
      teamInvitesApplied = await applyTeamInvitesFixIfNeeded(
        client,
        admin,
        teamInvitesFixSql
      )
    } catch (err) {
      console.warn('Targeted 033 (team_invites) failed:', err.message)
    }

    try {
      profileChangeRequestsApplied = await applyProfileChangeRequestsFixIfNeeded(
        client,
        admin,
        profileChangeRequestsFixSql,
        profileChangeRequestsPoliciesSql
      )
    } catch (err) {
      console.warn('Targeted 022 (profile_change_requests) failed:', err.message)
    }

    try {
      carrierConnectionInvitesApplied = await applyCarrierConnectionInvitesFixIfNeeded(
        client,
        admin,
        carrierConnectionInvitesFixSql,
        peFollowupSqls
      )
    } catch (err) {
      console.warn('Targeted 035 (carrier_connection_invites) failed:', err.message)
    }

    try {
      roleCheckApplied = await applyRoleCheckFixIfNeeded(client, roleCheckFixSql)
    } catch (err) {
      console.warn('Targeted 036 (role CHECK) failed:', err.message)
    }

    if (
      !permissionsApplied &&
      !teamInvitesApplied &&
      !profileChangeRequestsApplied &&
      !carrierConnectionInvitesApplied &&
      !roleCheckApplied
    ) {
      throw migrationError
    }
  }

  const triggerCheck = await checkPrivilegedColumnGuards(client)
  console.log('Privileged column trigger:', triggerCheck)
  if (triggerCheck !== 'ok') {
    process.exit(1)
  }

  const roleCheckOkAfter = await isMembershipRoleCheckOk(client)
  console.log('Membership role CHECK OK after apply:', roleCheckOkAfter)
  if (!roleCheckOkAfter) {
    process.exit(1)
  }
} finally {
  await client.end()
}

const afterVerify = await checkSchemaWithRetry(admin)
console.log('After:', afterVerify.results)
process.exit(afterVerify.ok ? 0 : 1)
