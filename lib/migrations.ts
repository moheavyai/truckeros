import fs from 'fs'
import path from 'path'
import manifest from './migration-manifest.json'

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations')

function readMigrationFile(filename: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8').trim()
}

/** Single ordered manifest shared by API route and apply-migrations script. */
export const MIGRATION_FILES = manifest.migrations as readonly string[]
export const API_MIGRATION_FILES = MIGRATION_FILES
export const SCRIPT_MIGRATION_FILES = MIGRATION_FILES

export function getMigrationSql(filename: string): string {
  return readMigrationFile(filename)
}

export function getMigration002Sql(): string {
  return getMigrationSql('002_add_cost_and_route_to_permit_requests.sql')
}

export function getMigration014Sql(): string {
  return getMigrationSql('014_add_drops_and_query_fields.sql')
}

export function getMigration017Sql(): string {
  return getMigrationSql('017_consolidate_rig_builder_schema.sql')
}

export function getMigration018Sql(): string {
  return getMigrationSql('018_member_profiles.sql')
}

export function getMigration019Sql(): string {
  return getMigrationSql('019_team_member_profiles.sql')
}

export function getMigration020Sql(): string {
  return getMigrationSql('020_member_profiles_privileged_columns.sql')
}

export function getMigration021Sql(): string {
  return getMigrationSql('021_multi_carrier_foundation.sql')
}

export function getMigration022Sql(): string {
  return getMigrationSql('022_profile_change_requests.sql')
}

export function getMigration023Sql(): string {
  return getMigrationSql('023_member_profiles_self_service_field_guard.sql')
}

export function getMigration024Sql(): string {
  return getMigrationSql('024_service_mode_membership_rls.sql')
}

export function getMigration025Sql(): string {
  return getMigrationSql('025_service_mode_role_scoped_rls.sql')
}

export function getMigration026Sql(): string {
  return getMigrationSql('026_split_owner_admin_roles.sql')
}

export function getMigration027Sql(): string {
  return getMigrationSql('027_team_invites_and_deletion_requests.sql')
}

export function getMigration028Sql(): string {
  return getMigrationSql('028_org_manager_rls_and_invite_accept.sql')
}

export function getMigration029Sql(): string {
  return getMigrationSql('029_tighten_invite_accept_rls.sql')
}

export function getMigration030Sql(): string {
  return getMigrationSql('030_owner_operator_user_roles.sql')
}

export function getMigration031Sql(): string {
  return getMigrationSql('031_team_member_profiles_permissions.sql')
}

export function getMigration032Sql(): string {
  return getMigrationSql('032_owner_bootstrap_membership_rls.sql')
}

export function getMigration033Sql(): string {
  return getMigrationSql('033_team_invites_table.sql')
}

export function getMigration034Sql(): string {
  return getMigrationSql('034_invite_accept_preserve_home_org.sql')
}

export function getMigration035Sql(): string {
  return getMigrationSql('035_carrier_connection_invites.sql')
}

export function getMigration036Sql(): string {
  return getMigrationSql('036_organization_memberships_role_check.sql')
}

export function getMigration037Sql(): string {
  return getMigrationSql('037_phase1b_membership_select_and_sm_clerk.sql')
}

export function getMigration038Sql(): string {
  return getMigrationSql('038_phase1_self_clerk_pe_and_accept_clerk.sql')
}

export function getMigration039Sql(): string {
  return getMigrationSql('039_phase1_self_clerk_insert_block.sql')
}

export function getMigration040Sql(): string {
  return getMigrationSql('040_phase1_team_invite_self_clerk_update.sql')
}

export function getMigration041Sql(): string {
  return getMigrationSql('041_phase1_team_invite_self_clerk_session_match.sql')
}

export function getFullMigrationSql(): string {
  return MIGRATION_FILES.map(readMigrationFile).join('\n\n')
}

export function getFullApiMigrationSql(): string {
  return getFullMigrationSql()
}

export function getScriptMigrationSql(): string {
  return getFullMigrationSql()
}