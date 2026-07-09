import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import manifest from './migration-manifest.json'
import {
  API_MIGRATION_FILES,
  MIGRATION_FILES,
  SCRIPT_MIGRATION_FILES,
  getFullApiMigrationSql,
  getFullMigrationSql,
  getMigration002Sql,
  getMigration014Sql,
  getMigration017Sql,
  getMigration018Sql,
  getMigration019Sql,
  getMigration020Sql,
  getMigration021Sql,
  getMigration022Sql,
  getMigration023Sql,
  getMigration024Sql,
  getMigration025Sql,
  getMigration026Sql,
  getMigration027Sql,
  getMigration028Sql,
  getMigration029Sql,
  getMigration030Sql,
  getMigration031Sql,
  getMigration032Sql,
  getMigration033Sql,
  getMigration034Sql,
  getMigration035Sql,
  getMigration036Sql,
  getMigration037Sql,
  getMigration038Sql,
  getMigration039Sql,
  getMigration040Sql,
  getMigration041Sql,
  getScriptMigrationSql,
} from './migrations'

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')

describe('migration manifest', () => {
  it('uses a single shared ordered list for API and script', () => {
    expect(MIGRATION_FILES).toEqual(manifest.migrations)
    expect(API_MIGRATION_FILES).toEqual(MIGRATION_FILES)
    expect(SCRIPT_MIGRATION_FILES).toEqual(MIGRATION_FILES)
    expect(MIGRATION_FILES).toEqual([
      '002_add_cost_and_route_to_permit_requests.sql',
      '014_add_drops_and_query_fields.sql',
      '017_consolidate_rig_builder_schema.sql',
      '018_member_profiles.sql',
      '019_team_member_profiles.sql',
      '020_member_profiles_privileged_columns.sql',
      '021_multi_carrier_foundation.sql',
      '022_profile_change_requests.sql',
      '023_member_profiles_self_service_field_guard.sql',
      '024_service_mode_membership_rls.sql',
      '025_service_mode_role_scoped_rls.sql',
      '026_split_owner_admin_roles.sql',
      '027_team_invites_and_deletion_requests.sql',
      '028_org_manager_rls_and_invite_accept.sql',
      '029_tighten_invite_accept_rls.sql',
      '030_owner_operator_user_roles.sql',
      '031_team_member_profiles_permissions.sql',
      '032_owner_bootstrap_membership_rls.sql',
      '033_team_invites_table.sql',
      '034_invite_accept_preserve_home_org.sql',
      '035_carrier_connection_invites.sql',
      '036_organization_memberships_role_check.sql',
      '037_phase1b_membership_select_and_sm_clerk.sql',
      '038_phase1_self_clerk_pe_and_accept_clerk.sql',
      '039_phase1_self_clerk_insert_block.sql',
      '040_phase1_team_invite_self_clerk_update.sql',
      '041_phase1_team_invite_self_clerk_session_match.sql',
    ])
  })

  it('references migration files that exist on disk', () => {
    for (const file of MIGRATION_FILES) {
      expect(fs.existsSync(path.join(migrationsDir, file))).toBe(true)
    }
  })

  it('includes key DDL fragments in consolidated SQL', () => {
    const sql = getFullMigrationSql()

    expect(sql).toContain('cost_breakdown')
    expect(sql).toContain('origin_query')
    expect(sql).toContain('destination_query')
    expect(sql).toContain('drops')
    expect(sql).toContain('license_plate')
    expect(sql).toContain('is_default')
    expect(sql).toContain('member_profiles')
    expect(sql).toContain('team_member_profiles')
    expect(sql).toContain('organization_id')
    expect(sql).toContain('is_primary_owner')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it('keeps API and script SQL helpers in sync', () => {
    expect(getFullApiMigrationSql()).toBe(getScriptMigrationSql())
    expect(getMigration002Sql()).toContain('cost_breakdown')
    expect(getMigration014Sql()).toContain('origin_query')
    expect(getMigration017Sql()).toContain('is_default')
    expect(getMigration018Sql()).toContain('member_profiles')
    expect(getMigration019Sql()).toContain('team_member_profiles')
    expect(getMigration020Sql()).toContain('enforce_member_profile_privileged_columns')
    expect(getMigration021Sql()).toContain('organizations')
    expect(getMigration022Sql()).toContain('profile_change_requests')
    expect(getMigration023Sql()).toContain('enforce_member_profile_self_service_restricted_fields')
    expect(getMigration024Sql()).toContain('auth_user_membership_org_ids')
    expect(getMigration025Sql()).toContain('auth_user_service_mode_org_ids')
    expect(getMigration026Sql()).toContain("'Owner'")
    expect(getMigration026Sql()).toContain("'Admin'")
    expect(getMigration027Sql()).toContain('team_invites')
    expect(getMigration027Sql()).toContain('deletion_requests')
    expect(getMigration028Sql()).toContain('auth_user_is_org_manager')
    expect(getMigration034Sql()).toContain('v_rewrite_home')
    expect(getMigration034Sql()).toContain('linked_user_id')
    expect(getMigration035Sql()).toContain('carrier_connection_invites')
    expect(getMigration035Sql()).toContain('accept_carrier_connection_invite')
    expect(getMigration035Sql()).toContain('preview_carrier_connection_invite')
    expect(getMigration035Sql()).toContain('enforce_member_profile_privileged_columns')
    expect(getMigration035Sql()).toContain('om.is_primary_owner = true')
    expect(getMigration036Sql()).toContain('organization_memberships_role_check')
    expect(getMigration036Sql()).toContain("'Owner'")
    expect(getMigration036Sql()).toContain("'Permit Clerk'")
    expect(getMigration036Sql()).toContain("ARRAY['Owner', 'Driver']")
    expect(getMigration037Sql()).toContain('auth_user_equipment_membership_org_ids')
    expect(getMigration037Sql()).toContain('auth_user_service_mode_org_ids')
  })

  it('migration 036 repairs organization_memberships_role_check for Owner/Admin/Permit Clerk', () => {
    const sql = getMigration036Sql()

    expect(sql).toContain('organization_memberships_role_check')
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS organization_memberships_role_check')
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS member_profiles_user_roles_check')
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS team_member_profiles_user_roles_check')
    expect(sql).toContain('ADD CONSTRAINT organization_memberships_role_check')
    expect(sql).toContain('member_profile_user_roles_valid')
    expect(sql).toContain('auth_user_service_mode_org_ids')
    expect(sql).toContain("role IN ('Permit Clerk', 'Owner', 'Admin')")
    expect(sql).toContain('outside allowlist after normalize')

    const membershipCheck = sql.match(
      /ADD CONSTRAINT organization_memberships_role_check\s+CHECK\s*\(\s*role = ANY\(ARRAY\[([\s\S]*?)\]::text\[\]\)/
    )
    expect(membershipCheck).not.toBeNull()
    const allowlist = membershipCheck![1]
    for (const role of ['Owner', 'Admin', 'Driver', 'Permit Clerk', 'Viewer']) {
      expect(allowlist).toContain(`'${role}'`)
    }
    expect(allowlist).not.toContain("'Owner Operator'")
    expect(allowlist).not.toContain("'Owner / Admin'")

    expect(sql).toContain("SET role = 'Owner'")
    expect(sql).toContain("SET role = 'Admin'")
    // Convert legacy combined role (exact + spacing variants) — never reintroduce it
    expect(sql).toMatch(/role\s*~\*\s*'\^Owner\\s\*\/\\s\*Admin\$'/)
    expect(sql).toContain('array_agg')
    expect(sql).not.toMatch(
      /ARRAY\['Owner \/ Admin',\s*'Driver'\]|ARRAY\['Owner \/ Admin'\]::text\[\]/
    )
    // 030-style Owner clamp before profile CHECK recreate
    expect(sql).toContain("ARRAY['Owner', 'Driver']")
    expect(sql).toContain("ARRAY['Owner']::text[]")
    expect(sql).toContain("OR 'Owner' = ANY")
    expect(sql).toContain('to_regclass')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
    expect(MIGRATION_FILES).toContain('036_organization_memberships_role_check.sql')

    const dropIdx = sql.indexOf(
      'DROP CONSTRAINT IF EXISTS organization_memberships_role_check'
    )
    const setOwnerIdx = sql.indexOf("SET role = 'Owner'")
    const clampIdx = sql.indexOf("OR 'Owner' = ANY")
    const addConstraintIdx = sql.indexOf(
      'ADD CONSTRAINT organization_memberships_role_check'
    )
    const addProfileIdx = sql.indexOf(
      'ADD CONSTRAINT member_profiles_user_roles_check'
    )
    expect(dropIdx).toBeGreaterThan(-1)
    expect(setOwnerIdx).toBeGreaterThan(dropIdx)
    expect(clampIdx).toBeGreaterThan(setOwnerIdx)
    expect(addConstraintIdx).toBeGreaterThan(clampIdx)
    expect(addProfileIdx).toBeGreaterThan(clampIdx)
    // Final profile allowlist must not include legacy combined role
    const profileValidFn = sql.match(
      /CREATE OR REPLACE FUNCTION member_profile_user_roles_valid[\s\S]*?\$\$;/
    )
    expect(profileValidFn).not.toBeNull()
    expect(profileValidFn![0]).toContain("'Owner'")
    expect(profileValidFn![0]).toContain("'Admin'")
    expect(profileValidFn![0]).not.toContain("'Owner / Admin'")
  })

  it('apply-migration-036 script loads 036 SQL from migrations dir', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'apply-migration-036.mjs')
    const applyMigrationsPath = path.join(process.cwd(), 'scripts', 'apply-migrations.mjs')
    const deprecated026 = path.join(
      process.cwd(),
      'scripts',
      'apply-migration-026-membership-role.mjs'
    )
    expect(fs.existsSync(scriptPath)).toBe(true)
    expect(fs.existsSync(applyMigrationsPath)).toBe(true)
    const script = fs.readFileSync(scriptPath, 'utf8')
    const applyAll = fs.readFileSync(applyMigrationsPath, 'utf8')
    const deprecated = fs.readFileSync(deprecated026, 'utf8')
    expect(script).toContain('036_organization_memberships_role_check.sql')
    expect(script).toContain('organization_memberships_role_check')
    expect(applyAll).toContain('036_organization_memberships_role_check.sql')
    expect(applyAll).toContain('ROLE_CHECK_HEALTH_SQL')
    expect(applyAll).toContain('roleChecksAllowSplitOwner')
    expect(applyAll).toContain('applyRoleCheckFixIfNeeded')
    expect(applyAll).toContain('membershipsTableExists')
    expect(deprecated).toContain('@deprecated')
    expect(deprecated).toContain('036_organization_memberships_role_check.sql')
  })

  it('apply-migration-022 script and apply-migrations wire profile_change_requests recovery', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'apply-migration-022.mjs')
    const applyMigrationsPath = path.join(process.cwd(), 'scripts', 'apply-migrations.mjs')
    expect(fs.existsSync(scriptPath)).toBe(true)
    expect(fs.existsSync(applyMigrationsPath)).toBe(true)
    const script = fs.readFileSync(scriptPath, 'utf8')
    const applyAll = fs.readFileSync(applyMigrationsPath, 'utf8')
    expect(script).toContain('022_profile_change_requests.sql')
    // Force script applies 023 policies after 022 (delete pending + owner WITH CHECK)
    expect(script).toContain('023_member_profiles_self_service_field_guard.sql')
    expect(script).toMatch(
      /loadMigration\('022_profile_change_requests\.sql'\)[\s\S]*loadMigration\('023_member_profiles_self_service_field_guard\.sql'\)/
    )
    expect(script).toContain('profile_change_requests')
    expect(script).toContain("NOTIFY pgrst, 'reload schema'")
    expect(script).toContain('update_updated_at_column')
    expect(script).toContain('verifyProfileChangeRequestsWithRetry')
    expect(script).toContain('POSTGREST_VERIFY_ATTEMPTS')
    expect(applyAll).toContain('022_profile_change_requests.sql')
    expect(applyAll).toContain('023_member_profiles_self_service_field_guard.sql')
    expect(applyAll).toContain('applyProfileChangeRequestsFixIfNeeded')
    expect(applyAll).toContain('isProfileChangeRequestsTablePossiblyMissing')
    expect(applyAll).toContain('isMissingRelationOrSchemaCacheError')
    expect(applyAll).toContain('migration-schema-heuristics.mjs')
    expect(applyAll).toContain("'profile_change_requests'")
    // Schema check columns for profile_change_requests
    expect(applyAll).toMatch(
      /profile_change_requests[\s\S]*organization_id[\s\S]*requester_user_id[\s\S]*field_key[\s\S]*status/
    )
    // Fast path when only this table is missing + PostgREST retry
    expect(applyAll).toContain('onlyProfileChangeRequestsMissing')
    expect(applyAll).toContain('Only profile_change_requests missing')
    // Fast-path gates: role CHECKs ok and every other table ok
    expect(applyAll).toMatch(
      /onlyProfileChangeRequestsMissing[\s\S]*roleCheckOkBefore[\s\S]*Object\.entries\(before\)\.every/
    )
    expect(applyAll).toMatch(
      /table === 'profile_change_requests' \|\| status === 'ok'/
    )
    expect(applyAll).toContain('checkSchemaWithRetry')
    expect(applyAll).toContain('POSTGREST_VERIFY_ATTEMPTS')
    // Targeted apply ensures helper + 023 policies + reloads schema cache
    expect(applyAll).toMatch(
      /applyProfileChangeRequestsFixIfNeeded[\s\S]*update_updated_at_column[\s\S]*profileChangeRequestsPoliciesSql[\s\S]*NOTIFY pgrst, 'reload schema'/
    )
    // Catch path isolates each targeted fix and rethrows only when none applied
    expect(applyAll).toContain('Targeted 022 (profile_change_requests) failed')
    expect(applyAll).toContain('Isolate each fix')
    expect(applyAll).toMatch(
      /!profileChangeRequestsApplied[\s\S]*!carrierConnectionInvitesApplied[\s\S]*!roleCheckApplied[\s\S]*throw migrationError/
    )
  })

  it('apply-migration-035 script and apply-migrations wire carrier_connection_invites recovery', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'apply-migration-035.mjs')
    const applyMigrationsPath = path.join(process.cwd(), 'scripts', 'apply-migrations.mjs')
    expect(fs.existsSync(scriptPath)).toBe(true)
    expect(fs.existsSync(applyMigrationsPath)).toBe(true)
    const script = fs.readFileSync(scriptPath, 'utf8')
    const applyAll = fs.readFileSync(applyMigrationsPath, 'utf8')
    expect(script).toContain('035_carrier_connection_invites.sql')
    expect(script).toContain('carrier_connection_invites')
    expect(script).toContain("NOTIFY pgrst, 'reload schema'")
    // Force script always applies full 035 then PE 038–041 (no Owner/Admin regression)
    expect(script).toContain('verifyCarrierConnectionInvitesWithRetry')
    expect(script).toContain('POSTGREST_VERIFY_ATTEMPTS')
    expect(script).toContain('Always re-applies the full 035')
    expect(script).toContain('PE_FOLLOWUP_MIGRATIONS')
    expect(script).toContain('038_phase1_self_clerk_pe_and_accept_clerk.sql')
    expect(script).toContain('039_phase1_self_clerk_insert_block.sql')
    expect(script).toContain('040_phase1_team_invite_self_clerk_update.sql')
    expect(script).toContain('041_phase1_team_invite_self_clerk_session_match.sql')
    expect(script).toContain('assertAcceptRpcPermitClerkOnly')
    expect(script).toContain('migration-schema-heuristics.mjs')
    expect(applyAll).toContain('035_carrier_connection_invites.sql')
    expect(applyAll).toContain('applyCarrierConnectionInvitesFixIfNeeded')
    expect(applyAll).toContain('isCarrierConnectionInvitesTablePossiblyMissing')
    expect(applyAll).toContain('isMissingRelationOrSchemaCacheError')
    expect(applyAll).toContain('migration-schema-heuristics.mjs')
    expect(applyAll).toContain("'carrier_connection_invites'")
    // PE follow-up after targeted 035 + fail if accept RPC not Clerk-only
    expect(applyAll).toContain('PE_FOLLOWUP_MIGRATION_FILES')
    expect(applyAll).toContain('peFollowupSqls')
    expect(applyAll).toContain('Re-applied PE migrations 038-041 after targeted 035')
    expect(applyAll).toContain('assertAcceptRpcPermitClerkOnly')
    expect(applyAll).toMatch(
      /assertAcceptRpcPermitClerkOnly\(client\)[\s\S]*PE regression after targeted 035/
    )
    // Fast path when only this table is missing + PostgREST retry
    expect(applyAll).toContain('onlyCarrierConnectionInvitesMissing')
    expect(applyAll).toContain('Only carrier_connection_invites missing')
    expect(applyAll).toMatch(
      /onlyCarrierConnectionInvitesMissing[\s\S]*roleCheckOkBefore[\s\S]*Object\.entries\(before\)\.every/
    )
    expect(applyAll).toMatch(
      /table === 'carrier_connection_invites' \|\| status === 'ok'/
    )
    expect(applyAll).toContain('checkSchemaWithRetry')
    // Targeted apply reloads schema cache and chains PE
    expect(applyAll).toMatch(
      /applyCarrierConnectionInvitesFixIfNeeded[\s\S]*peFollowupSqls[\s\S]*NOTIFY pgrst, 'reload schema'/
    )
    // Catch path isolates each targeted fix (one failure must not skip later fixes)
    expect(applyAll).toContain('Targeted 035 (carrier_connection_invites) failed')
    expect(applyAll).toContain('Targeted 036 (role CHECK) failed')
    expect(applyAll).toContain('Isolate each fix')
  })

  it('migration 035 locks RLS membership scope, email-required, USDOT unique, accept defense', () => {
    const sql = getMigration035Sql()

    // RLS: inviter + membership manager helper
    expect(sql).toContain('auth_user_can_manage_carrier_connection')
    expect(sql).toContain('auth_user_can_manage_carrier_connection(organization_id)')
    expect(sql).toContain("om.role IN ('Owner', 'Admin', 'Permit Clerk')")

    // Accept path grants Owner membership
    expect(sql).toMatch(/INSERT INTO organization_memberships\s*\([\s\S]*?'Owner'/)
    expect(sql).toContain("user_roles = ARRAY['Owner']::text[]")

    // Column protection trigger (clients cannot rebind org/token/email or burn accept)
    expect(sql).toContain('protect_carrier_connection_invite_columns')
    expect(sql).toContain('Cannot modify protected carrier connection invite fields')
    expect(sql).toContain('Cannot set accept fields on carrier connection invites')
    expect(sql).toContain('Clients may only revoke or expire pending carrier connection invites')

    // Accept RPC GUC bypass so claim succeeds under acceptor JWT (not service role)
    expect(sql).toContain("set_config('truckeros.carrier_invite_accept', '1', true)")
    expect(sql).toContain("current_setting('truckeros.carrier_invite_accept', true)")
    expect(sql).toMatch(
      /PERFORM set_config\('truckeros\.carrier_invite_accept', '1', true\);[\s\S]*UPDATE carrier_connection_invites/
    )

    // Email required for Owner-granting invites
    expect(sql).toContain('invite_email text NOT NULL')
    expect(sql).toContain("CHECK (NULLIF(trim(invite_email), '') IS NOT NULL)")

    // Unique USDOT — non-fatal DO block so duplicates cannot block table create
    expect(sql).toContain('idx_organizations_usdot_number_unique')
    expect(sql).toMatch(
      /DO \$\$[\s\S]*CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_usdot_number_unique[\s\S]*EXCEPTION[\s\S]*unique_violation[\s\S]*RAISE WARNING/
    )
    expect(sql).toContain('duplicate non-empty usdot_number values exist on organizations')

    // Accept defense-in-depth + explicit primary owner flag
    expect(sql).toContain('This carrier already has a primary owner')
    expect(sql).toContain('v_pending.invited_by_user_id')
    expect(sql).toContain("status = 'pending'")
    expect(sql).toContain('RETURNING * INTO v_invite')
    expect(sql).toContain('is_primary_owner = true')
    expect(sql).not.toContain('is_primary_owner = organization_memberships.is_primary_owner OR true')
  })

  it('migration 034 locks claim-first, primary preserve, membership trigger allow, roster link', () => {
    const sql = getMigration034Sql()

    // Claim-first atomic accept
    expect(sql).toContain("status = 'pending'")
    expect(sql).toContain('RETURNING * INTO v_invite')
    expect(sql).toContain('expires_at > now()')

    // Never demote primary owner on membership conflict
    expect(sql).toContain('is_primary_owner = organization_memberships.is_primary_owner')
    expect(sql).toContain('WHEN organization_memberships.is_primary_owner THEN organization_memberships.role')

    // Conditional home rewrite skips primary owners
    expect(sql).toContain('AND NOT COALESCE(v_existing_primary, false)')

    // Narrow membership-based trigger allow (no session GUC bypass)
    expect(sql).not.toContain('truckeros.invite_accept')
    expect(sql).not.toContain("set_config('truckeros.invite_accept'")
    expect(sql).toContain('FROM organization_memberships om')
    expect(sql).toContain('NEW.user_roles = ARRAY[om.role]::text[]')

    // Case-insensitive roster link
    expect(sql).toContain('lower(trim(driver_email))')
    expect(sql).toContain('linked_user_id = v_uid')

    // Permissions preserved on re-accept
    expect(sql).toContain(
      'permissions = COALESCE(organization_memberships.permissions, EXCLUDED.permissions)'
    )
  })

  it('includes member_profiles DDL with RLS, role CHECK, and updated_at trigger', () => {
    const sql = getMigration018Sql()

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS member_profiles')
    expect(sql).toContain("cdl_state ~ '^[A-Z]{2}$'")
    expect(sql).toContain('user_roles <@ ARRAY[')
    expect(sql).toContain("'Owner / Admin'")
    expect(sql).toContain("'Permit Clerk'")
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('Users can view their own member profile')
    expect(sql).toContain('Users can insert their own member profile')
    expect(sql).toContain('Users can update their own member profile')
    expect(sql).toContain('update_member_profiles_updated_at')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it('includes team member management DDL with org scoping and primary-owner RLS', () => {
    const sql = getMigration019Sql()

    expect(sql).toContain('ALTER TABLE member_profiles')
    expect(sql).toContain('organization_id uuid')
    expect(sql).toContain('is_primary_owner boolean')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS team_member_profiles')
    expect(sql).toContain('linked_user_id uuid')
    expect(sql).toContain('auth_user_organization_id')
    expect(sql).toContain('auth_user_is_primary_owner')
    expect(sql).toContain('Org members can view profiles in their organization')
    expect(sql).toContain('Users can update own profile or primary owner updates org')
    expect(sql).toContain('Primary owner can delete other org member profiles')
    expect(sql).toContain('Org members can view team roster in their organization')
    expect(sql).toContain('Primary owner can delete team roster entries')
    expect(sql).toContain('update_team_member_profiles_updated_at')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it('includes privileged column guard triggers for member_profiles self-service writes', () => {
    const sql = getMigration020Sql()

    expect(sql).toContain('enforce_member_profile_privileged_columns')
    expect(sql).toContain('member_profile_org_already_exists')
    expect(sql).toContain('Cannot change organization_id on self-update')
    expect(sql).toContain('Cannot change is_primary_owner on self-update')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it('includes multi-carrier foundation DDL with org tables and Dispatcher removal', () => {
    const sql = getMigration021Sql()

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS organizations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS organization_memberships')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS carrier_link_requests')
    expect(sql).toContain('equipment_profiles')
    expect(sql).toContain("array_replace(user_roles, 'Dispatcher', 'Driver')")
    expect(sql).toContain("'Permit Clerk'")
    expect(sql).toContain('member_profiles_user_roles_check')
    expect(sql).not.toMatch(/user_roles <@[\s\S]*'Dispatcher'/)
    expect(sql).toContain('auth_user_membership_org_ids')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it('includes profile change request DDL with field allowlist and pending dedupe index', () => {
    const sql = getMigration022Sql()

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS profile_change_requests')
    expect(sql).toContain("field_key IN ('driver_full_name', 'cdl_number', 'cdl_state', 'date_of_birth')")
    expect(sql).toContain('idx_profile_change_requests_pending_dedupe')
    expect(sql).toContain('Users can insert own profile change requests')
    expect(sql).toContain('Primary owners can update org profile change requests')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it('extends membership-based read RLS for service mode carrier scoping', () => {
    const sql = getMigration024Sql()

    expect(sql).toContain('member_profiles')
    expect(sql).toContain('team_member_profiles')
    expect(sql).toContain('equipment_profiles')
    expect(sql).toContain('rig_configurations')
    expect(sql).toContain('auth_user_membership_org_ids')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it('restricts cross-carrier service-mode reads to Permit Clerk and Owner / Admin', () => {
    const sql = getMigration025Sql()

    expect(sql).toContain('auth_user_service_mode_org_ids')
    expect(sql).toContain("'Permit Clerk'")
    expect(sql).toContain("'Owner / Admin'")
    expect(sql).toContain('member_profiles')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it('migration 037 restores membership SELECT then narrows SM helper to Permit Clerk', () => {
    const sql = getMigration037Sql()

    expect(sql).toContain('auth_user_equipment_membership_org_ids')
    expect(sql).toContain("role IN ('Owner', 'Admin', 'Permit Clerk')")
    expect(sql).toContain('auth_user_membership_org_ids')
    expect(sql).toContain('auth_user_service_mode_org_ids')
    expect(sql).toContain("role = 'Permit Clerk'")
    expect(sql).toContain('member_profiles')
    expect(sql).toContain('team_member_profiles')
    expect(sql).toContain('equipment_profiles')
    expect(sql).toContain('rig_configurations')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
    expect(MIGRATION_FILES).toContain('037_phase1b_membership_select_and_sm_clerk.sql')

    // Order: restore membership paths before narrowing SM helper
    const equipHelperIdx = sql.indexOf('auth_user_equipment_membership_org_ids')
    const membershipPathIdx = sql.indexOf('auth_user_membership_org_ids()')
    const narrowIdx = sql.indexOf("role = 'Permit Clerk'")
    expect(equipHelperIdx).toBeGreaterThan(-1)
    expect(membershipPathIdx).toBeGreaterThan(-1)
    expect(narrowIdx).toBeGreaterThan(membershipPathIdx)

    // SM helper body must not keep Owner/Admin IN list
    const smFn = sql.match(
      /CREATE OR REPLACE FUNCTION auth_user_service_mode_org_ids\(\)[\s\S]*?\$\$;/
    )
    expect(smFn).not.toBeNull()
    expect(smFn![0]).toContain("role = 'Permit Clerk'")
    expect(smFn![0]).not.toContain("'Owner'")
    expect(smFn![0]).not.toContain("'Admin'")

    const scriptPath = path.join(process.cwd(), 'scripts', 'apply-migration-037.mjs')
    expect(fs.existsSync(scriptPath)).toBe(true)
    expect(fs.readFileSync(scriptPath, 'utf8')).toContain(
      '037_phase1b_membership_select_and_sm_clerk.sql'
    )

    // Equipment membership helper appears before final SM helper narrow
    const equipFnIdx = sql.indexOf('CREATE OR REPLACE FUNCTION auth_user_equipment_membership_org_ids')
    const smFnIdx = sql.lastIndexOf('CREATE OR REPLACE FUNCTION auth_user_service_mode_org_ids')
    expect(equipFnIdx).toBeGreaterThan(-1)
    expect(smFnIdx).toBeGreaterThan(equipFnIdx)

    // Policy restore for all four tables before SM helper body is rewritten
    const mpPolicy = sql.indexOf(
      'CREATE POLICY "Org members can view profiles in their organization"'
    )
    const rosterPolicy = sql.indexOf(
      'CREATE POLICY "Org members can view team roster in their organization"'
    )
    const equipPolicy = sql.indexOf('CREATE POLICY "Members can view org equipment profiles"')
    const rigPolicy = sql.indexOf(
      'CREATE POLICY "Members can view carrier primary owner rig configs"'
    )
    expect(mpPolicy).toBeGreaterThan(-1)
    expect(rosterPolicy).toBeGreaterThan(mpPolicy)
    expect(equipPolicy).toBeGreaterThan(rosterPolicy)
    expect(rigPolicy).toBeGreaterThan(equipPolicy)
    expect(smFnIdx).toBeGreaterThan(rigPolicy)
    // Roster membership path restored (not home-only)
    expect(sql).toContain(
      'OR organization_id IN (SELECT auth_user_membership_org_ids())'
    )
  })

  it('migration 038 adds self-Clerk PE triggers and accept inviter Clerk-only', () => {
    const sql = getMigration038Sql()

    expect(sql).toContain('enforce_no_self_promote_to_permit_clerk')
    expect(sql).toContain('enforce_no_self_permit_clerk_team_invite')
    expect(sql).toContain('trg_no_self_promote_to_permit_clerk')
    expect(sql).toContain('trg_no_self_permit_clerk_team_invite')
    expect(sql).toContain('accept_carrier_connection_invite')
    expect(sql).toContain("om.role = 'Permit Clerk'")
    expect(sql).not.toContain("om.role IN ('Owner', 'Admin', 'Permit Clerk')")
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
    expect(MIGRATION_FILES).toContain('038_phase1_self_clerk_pe_and_accept_clerk.sql')

    // Membership PE: service_role exempt + stay-as-Clerk on UPDATE
    const membershipPe = sql.match(
      /CREATE OR REPLACE FUNCTION enforce_no_self_promote_to_permit_clerk\(\)[\s\S]*?\$\$;/
    )
    expect(membershipPe).not.toBeNull()
    expect(membershipPe![0]).toContain('auth.uid() IS NULL')
    expect(membershipPe![0]).toContain('RETURN NEW')
    expect(membershipPe![0]).toContain("TG_OP = 'UPDATE'")
    expect(membershipPe![0]).toContain("OLD.role IS NOT DISTINCT FROM 'Permit Clerk'")
    expect(membershipPe![0]).toContain(
      'Cannot reassign your own membership role to Permit Clerk'
    )

    // Team invite PE: service_role exempt
    const invitePe = sql.match(
      /CREATE OR REPLACE FUNCTION enforce_no_self_permit_clerk_team_invite\(\)[\s\S]*?\$\$;/
    )
    expect(invitePe).not.toBeNull()
    expect(invitePe![0]).toContain('auth.uid() IS NULL')
    expect(invitePe![0]).toContain("Cannot invite yourself as Permit Clerk")

    // Accept inviter defense: Clerk only (no Owner/Admin/primary short-circuit list)
    const acceptFn = sql.match(
      /CREATE OR REPLACE FUNCTION accept_carrier_connection_invite\(p_token text\)[\s\S]*?\$\$;/
    )
    expect(acceptFn).not.toBeNull()
    expect(acceptFn![0]).toContain("om.role = 'Permit Clerk'")
    expect(acceptFn![0]).not.toContain("om.role IN ('Owner', 'Admin', 'Permit Clerk')")

    const scriptPath = path.join(process.cwd(), 'scripts', 'apply-migration-038.mjs')
    expect(fs.existsSync(scriptPath)).toBe(true)
    expect(fs.readFileSync(scriptPath, 'utf8')).toContain(
      '038_phase1_self_clerk_pe_and_accept_clerk.sql'
    )
  })

  it('migration 039 blocks self-INSERT as Permit Clerk and sets invite accept GUC', () => {
    const sql = getMigration039Sql()

    expect(sql).toContain('trg_no_self_promote_to_permit_clerk_insert')
    expect(sql).toContain('BEFORE INSERT ON organization_memberships')
    expect(sql).toContain("TG_OP = 'INSERT'")
    expect(sql).toContain('truckeros.team_invite_accept')
    expect(sql).toContain('accept_team_invite')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
    expect(MIGRATION_FILES).toContain('039_phase1_self_clerk_insert_block.sql')

    const membershipPe = sql.match(
      /CREATE OR REPLACE FUNCTION enforce_no_self_promote_to_permit_clerk\(\)[\s\S]*?\$\$;/
    )
    expect(membershipPe).not.toBeNull()
    // service_role exempt
    expect(membershipPe![0]).toContain('auth.uid() IS NULL')
    // stay-as-Clerk on UPDATE
    expect(membershipPe![0]).toContain("OLD.role IS NOT DISTINCT FROM 'Permit Clerk'")
    // INSERT block for JWT self Clerk
    expect(membershipPe![0]).toContain("TG_OP = 'INSERT'")
    expect(membershipPe![0]).toContain(
      'Cannot reassign your own membership role to Permit Clerk'
    )
    // Invite accept GUC bypass
    expect(membershipPe![0]).toContain('truckeros.team_invite_accept')
    expect(membershipPe![0]).toContain('truckeros.carrier_invite_accept')

    // accept_team_invite must set GUC before membership write
    const acceptTeam = sql.match(
      /CREATE OR REPLACE FUNCTION accept_team_invite\(p_token text\)[\s\S]*?\$\$;/
    )
    expect(acceptTeam).not.toBeNull()
    const gucIdx = acceptTeam![0].indexOf("set_config('truckeros.team_invite_accept'")
    const insertIdx = acceptTeam![0].indexOf('INSERT INTO organization_memberships')
    expect(gucIdx).toBeGreaterThan(-1)
    expect(insertIdx).toBeGreaterThan(gucIdx)

    const scriptPath = path.join(process.cwd(), 'scripts', 'apply-migration-039.mjs')
    expect(fs.existsSync(scriptPath)).toBe(true)
    expect(fs.readFileSync(scriptPath, 'utf8')).toContain(
      '039_phase1_self_clerk_insert_block.sql'
    )
  })

  it('migration 040 runs team_invites self-Clerk PE on UPDATE as well as INSERT', () => {
    const sql = getMigration040Sql()

    expect(sql).toContain('enforce_no_self_permit_clerk_team_invite')
    expect(sql).toContain('trg_no_self_permit_clerk_team_invite_update')
    expect(sql).toContain('BEFORE UPDATE ON team_invites')
    expect(sql).toContain('BEFORE INSERT ON team_invites')
    expect(sql).toContain("TG_OP = 'UPDATE'")
    expect(sql).toContain('invite_email IS NOT DISTINCT FROM OLD.invite_email')
    expect(sql).toContain('invite_phone IS NOT DISTINCT FROM OLD.invite_phone')
    expect(sql).toContain("Cannot invite yourself as Permit Clerk")
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
    expect(MIGRATION_FILES).toContain('040_phase1_team_invite_self_clerk_update.sql')

    const invitePe = sql.match(
      /CREATE OR REPLACE FUNCTION enforce_no_self_permit_clerk_team_invite\(\)[\s\S]*?\$\$;/
    )
    expect(invitePe).not.toBeNull()
    // service_role exempt
    expect(invitePe![0]).toContain('auth.uid() IS NULL')
    // status-only UPDATE short-circuit
    expect(invitePe![0]).toContain("TG_OP = 'UPDATE'")
    expect(invitePe![0]).toContain('invite_email IS NOT DISTINCT FROM OLD.invite_email')
    expect(invitePe![0]).toContain('invite_phone IS NOT DISTINCT FROM OLD.invite_phone')

    // UPDATE path must re-validate when role changes to Clerk (not status-only)
    const updateSkipIdx = sql.indexOf('invite_email IS NOT DISTINCT FROM OLD.invite_email')
    const raiseIdx = sql.indexOf("Cannot invite yourself as Permit Clerk")
    expect(updateSkipIdx).toBeGreaterThan(-1)
    expect(raiseIdx).toBeGreaterThan(updateSkipIdx)

    const scriptPath = path.join(process.cwd(), 'scripts', 'apply-migration-040.mjs')
    expect(fs.existsSync(scriptPath)).toBe(true)
    expect(fs.readFileSync(scriptPath, 'utf8')).toContain(
      '040_phase1_team_invite_self_clerk_update.sql'
    )
  })

  it('migration 041 matches self-Clerk PE to session user not invited_by only', () => {
    const sql = getMigration041Sql()

    expect(sql).toContain('enforce_no_self_permit_clerk_team_invite')
    expect(sql).toContain('session user')
    expect(sql).toContain('independent of invited_by')
    expect(sql).toContain('FROM auth.users')
    expect(sql).toContain("Cannot invite yourself as Permit Clerk")
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
    expect(MIGRATION_FILES).toContain('041_phase1_team_invite_self_clerk_session_match.sql')

    const invitePe = sql.match(
      /CREATE OR REPLACE FUNCTION enforce_no_self_permit_clerk_team_invite\(\)[\s\S]*?\$\$;/
    )
    expect(invitePe).not.toBeNull()
    // service_role exempt
    expect(invitePe![0]).toContain('auth.uid() IS NULL')
    // session contact match (not invited_by gate)
    expect(invitePe![0]).toContain('FROM auth.users')
    expect(invitePe![0]).toContain('WHERE u.id = auth.uid()')
    expect(invitePe![0]).toContain('WHERE mp.user_id = auth.uid()')
    expect(invitePe![0]).not.toMatch(
      /invited_by_user_id\s+IS\s+DISTINCT\s+FROM\s+auth\.uid\(\)[\s\S]{0,120}RETURN NEW/i
    )

    // Must NOT early-return solely because invited_by differs from auth.uid()
    expect(sql).not.toMatch(
      /invited_by_user_id\s+IS\s+DISTINCT\s+FROM\s+auth\.uid\(\)\s*;\s*\n\s*RETURN NEW/i
    )
    expect(sql).not.toContain(
      'Only when inviter is the current JWT user'
    )

    // Session contact match must still run for Permit Clerk rows
    expect(sql).toContain("NEW.role IS DISTINCT FROM 'Permit Clerk'")
    expect(sql).toContain('WHERE u.id = auth.uid()')
    expect(sql).toContain('WHERE mp.user_id = auth.uid()')

    const scriptPath = path.join(process.cwd(), 'scripts', 'apply-migration-041.mjs')
    expect(fs.existsSync(scriptPath)).toBe(true)
    expect(fs.readFileSync(scriptPath, 'utf8')).toContain(
      '041_phase1_team_invite_self_clerk_session_match.sql'
    )
  })

  it('splits Owner / Admin into Owner and Admin roles in migration 026', () => {
    const sql = getMigration026Sql()

    // Convert legacy combined membership/profile roles before recreating CHECKs
    expect(sql).toMatch(/role\s*~\*\s*'\^Owner\\s\*\/\\s\*Admin\$'/)
    expect(sql).toContain("WHEN elem ~* '^Owner\\s*/\\s*Admin$' AND COALESCE(is_primary_owner, false) THEN 'Owner'")
    expect(sql).toContain("WHEN elem ~* '^Owner\\s*/\\s*Admin$' THEN 'Admin'")
    expect(sql).toContain("role IN ('Permit Clerk', 'Owner', 'Admin')")
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS member_profiles_user_roles_check')
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS team_member_profiles_user_roles_check')

    // Membership role rewrite must drop legacy CHECK before setting Owner/Admin
    const dropIdx = sql.indexOf(
      'DROP CONSTRAINT IF EXISTS organization_memberships_role_check'
    )
    const setOwnerIdx = sql.indexOf("SET role = 'Owner'")
    const addIdx = sql.indexOf('ADD CONSTRAINT organization_memberships_role_check')
    expect(dropIdx).toBeGreaterThan(-1)
    expect(setOwnerIdx).toBeGreaterThan(dropIdx)
    expect(addIdx).toBeGreaterThan(setOwnerIdx)

    const membershipCheck = sql.match(
      /ADD CONSTRAINT organization_memberships_role_check\s+CHECK\s*\(\s*role = ANY\(ARRAY\[([\s\S]*?)\]::text\[\]\)/
    )
    expect(membershipCheck).not.toBeNull()
    const allowlist = membershipCheck![1]
    for (const role of ['Owner', 'Admin', 'Driver', 'Permit Clerk', 'Viewer']) {
      expect(allowlist).toContain(`'${role}'`)
    }
    expect(allowlist).not.toContain("'Owner Operator'")
    expect(allowlist).not.toContain("'Owner / Admin'")
  })

  it('adds org manager RLS and invite accept policies in migration 028', () => {
    const sql = getMigration028Sql()

    expect(sql).toContain('auth_user_is_org_manager')
    expect(sql).toContain('Org managers can insert team roster entries')
    expect(sql).toContain('Invitees can accept matching pending invites')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it('tightens invite accept RLS and adds RPC functions in migration 029', () => {
    const sql = getMigration029Sql()

    expect(sql).toContain('DROP POLICY IF EXISTS "Users can insert own membership on invite accept"')
    expect(sql).toContain('DROP POLICY IF EXISTS "Invitees can view matching pending invites"')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION preview_team_invite')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION accept_team_invite')
    expect(sql).toContain('ON CONFLICT (organization_id, user_id) DO UPDATE')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it('allows Owner Operator role combination in migration 030', () => {
    const sql = getMigration030Sql()

    expect(sql).toContain('member_profile_user_roles_valid')
    expect(sql).toContain('member_profiles_user_roles_check')
    expect(sql).toContain("ARRAY['Owner', 'Driver']")
    expect(sql).toContain("'Owner / Admin'")
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
    expect(MIGRATION_FILES).toContain('030_owner_operator_user_roles.sql')
  })

  it('adds team invites, deletion requests, and permissions column in migration 027', () => {
    const sql = getMigration027Sql()

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS team_invites')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS deletion_requests')
    expect(sql).toContain('team_member_profiles')
    expect(sql).toContain('permissions jsonb')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it('adds idempotent team_member_profiles.permissions column in migration 031', () => {
    const sql = getMigration031Sql()

    expect(sql).toContain('team_member_profiles')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS permissions jsonb')
    expect(sql).toContain('027_team_invites_and_deletion_requests.sql')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
    expect(MIGRATION_FILES).toContain('031_team_member_profiles_permissions.sql')
  })

  it('adds owner bootstrap membership RLS policy in migration 032', () => {
    const sql = getMigration032Sql()

    expect(sql).toContain('Org creators can insert primary owner membership')
    expect(sql).toContain('organization_memberships')
    expect(MIGRATION_FILES).toContain('032_owner_bootstrap_membership_rls.sql')
  })

  it('adds idempotent team_invites table in migration 033', () => {
    const sql = getMigration033Sql()

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS team_invites')
    expect(sql).toContain('027_team_invites_and_deletion_requests.sql')
    expect(sql).toContain('028_org_manager_rls_and_invite_accept.sql')
    expect(sql).toContain('029_tighten_invite_accept_rls.sql')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
    expect(MIGRATION_FILES).toContain('033_team_invites_table.sql')
  })

  it('includes member_profiles self-service field guard trigger and change-request withdraw policy', () => {
    const sql = getMigration023Sql()

    expect(sql).toContain('enforce_member_profile_self_service_restricted_fields')
    expect(sql).toContain('NEW.user_roles := OLD.user_roles')
    expect(sql).toContain('NEW.company_name := OLD.company_name')
    expect(sql).toContain('NEW.driver_full_name := OLD.driver_full_name')
    expect(sql).toContain('NEW.cdl_number := OLD.cdl_number')
    expect(sql).toContain('NEW.cdl_state := OLD.cdl_state')
    expect(sql).toContain('NEW.date_of_birth := OLD.date_of_birth')
    expect(sql).toContain('Users can delete own pending profile change requests')
    expect(sql).toContain('WITH CHECK')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
  })
})