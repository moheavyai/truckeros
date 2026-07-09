/**
 * Profile UI tests use static source inspection rather than render/interaction tests.
 * This is an accepted project limitation until a React render harness (e.g. RTL) is adopted.
 * Runtime behavior (dropdown switching, discard prompts, success/error rendering) is not
 * verified here; handler wiring and guard expressions are asserted via source slices instead.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const profilePagePath = path.join(process.cwd(), 'app', 'profile', 'page.tsx')
const teamMemberProfilesApiPath = path.join(process.cwd(), 'lib', 'team-member-profiles-api.ts')
const memberProfilePath = path.join(process.cwd(), 'lib', 'member-profile.ts')

function readProfileSource() {
  return readFileSync(profilePagePath, 'utf8')
}

function readTeamMemberProfilesApiSource() {
  return readFileSync(teamMemberProfilesApiPath, 'utf8')
}

function memberEditCardSlice(source: string) {
  const start = source.indexOf('{showMemberEditCard && (')
  const end = source.indexOf('{showTeamSection && (', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function bootstrapSetupCardSlice(source: string) {
  const start = source.indexOf('{showOwnerBootstrapSetup && (')
  const end = source.indexOf('{showCarrierCard && (', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function carrierCardSlice(source: string) {
  const start = source.indexOf('{showCarrierCard && (')
  const end = source.indexOf('{showMemberEditCard && (', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function teamRosterSectionSlice(source: string) {
  const start = source.indexOf('id="saved-team-members"')
  const end = source.indexOf(
    'isDriverSelfServiceActor(effectiveOwnProfile) &&\n          ownPendingChangeRequests.length > 0',
    start
  )
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function handleSaveCarrierInfoSlice(source: string) {
  const start = source.indexOf('async function handleSaveCarrierInfo')
  const end = source.indexOf('async function sendTeamInviteAfterMemberSave', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function handleSaveSlice(source: string) {
  const start = source.indexOf('async function handleSave(e: React.FormEvent, options?: { andInvite?: boolean })')
  const end = source.indexOf('async function handleSaveAndInvite', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('Profile page UI', () => {
  it('shows success toast when arriving with ?invite=accepted', () => {
    const source = readProfileSource()
    expect(source).toContain("params.get('invite') === 'accepted'")
    expect(source).toContain('Invite accepted. Welcome to the team.')
    expect(source).toContain("window.history.replaceState({}, '', ONBOARDING_PATH)")
  })

  it('shows success toast when arriving with ?carrier_connection=accepted', () => {
    const source = readProfileSource()
    expect(source).toContain("params.get('carrier_connection') === 'accepted'")
    expect(source).toContain('Carrier connection accepted. You are now the Carrier Owner.')
  })

  it('documents source-only inspection as accepted RTL limitation without a render harness', () => {
    const source = readProfileSource()
    const testFileHeader = readFileSync(path.join(process.cwd(), 'app', 'profile', 'profile-ui.test.ts'), 'utf8')
      .split('\n')
      .slice(0, 6)
      .join('\n')

    expect(testFileHeader).toMatch(/Profile UI tests use static source inspection/)
    expect(testFileHeader).toMatch(/accepted project limitation/)
    expect(testFileHeader).toMatch(/React render harness/)
    expect(typeof readProfileSource).toBe('function')
    expect(source).toMatch(/export default function ProfilePage|function ProfilePage/)
    expect(source).toContain('handleEditMember')
    expect(source).not.toContain('@testing-library/react')
    expect(source).not.toContain('render(')
  })

  it('uses AppHeader with profile activePage', () => {
    const source = readProfileSource()

    expect(source).toContain('ownOrganizationId={effectiveOwnProfile?.organization_id ?? ownProfile?.organization_id}')
  })

  it('guards auth and always clears loading state', () => {
    const source = readProfileSource()

    expect(source).toContain("router.push('/login')")
    expect(source).toContain('supabase.auth.getSession()')
    expect(source).toMatch(/setLoading\(false\)/)
    expect(source).not.toMatch(/router\.push\('\/login'\)\s*\n\s*return\s*\n/)
  })

  it('allows save on first visit when no profile row exists yet', () => {
    const source = readProfileSource()

    expect(source).toContain('.maybeSingle()')
    expect(source).toContain("source: 'member_profile'")
    expect(source).not.toContain("upsert(payload, { onConflict: 'user_id' })")
    expect(source).toContain('canWriteTeamData(actingPermissionActor)')
    expect(source).toContain('isProfileBootstrap')
    expect(source).toContain('needsPrimaryOwnerBootstrap')
    expect(source).toContain('effectiveOwnProfile')
    expect(source).toContain('memberSaveDisabled')
    expect(source).toContain('memberEditSaveDisabled')
    expect(source).not.toMatch(/disabled=\{!canWriteProfile \|\| saving\}/)
    expect(source).not.toContain('loadError')
    expect(source).not.toContain('Failed to load profile')
    expect(source).not.toMatch(/if \(!user \|\| loadError\) return/)
  })

  it('renders landing sections with carrier card and team roster', () => {
    const source = readProfileSource()

    expect(source).toContain('Carrier Information')
    expect(source).toContain('Team Roster')
    expect(source).toContain('shouldShowLandingProfileView')
    expect(source).toContain('shouldShowMemberEditCard')
    expect(source).not.toContain('Team Members')
    expect(source).not.toContain('Done editing carrier')
    expect(source).not.toContain('Driver / User Information')
  })

  it('orders driver identity fields before CDL state and date of birth in member edit card', () => {
    const memberCard = memberEditCardSlice(readProfileSource())

    const identityIdx = memberCard.indexOf('DRIVER_IDENTITY_FIELDS.map')
    const stateIdx = memberCard.indexOf('id="cdl_state"')
    const dobIdx = memberCard.indexOf('id="date_of_birth"')
    const contactIdx = memberCard.indexOf('DRIVER_CONTACT_FIELDS.map')

    expect(identityIdx).toBeGreaterThan(-1)
    expect(stateIdx).toBeGreaterThan(identityIdx)
    expect(dobIdx).toBeGreaterThan(stateIdx)
    expect(contactIdx).toBeGreaterThan(dobIdx)
  })

  it('caps date of birth at today and announces save feedback', () => {
    const source = readProfileSource()

    expect(source).toContain('max={maxDateOfBirth}')
    expect(source).toContain('todayIsoDate')
    expect(source).toContain('role="status"')
    expect(source).toContain('aria-live="polite"')
  })

  it('renders team roster with add, edit, and delete actions', () => {
    const source = readProfileSource()
    const rosterSection = teamRosterSectionSlice(source)

    expect(source).toContain('buildTeamMemberList')
    expect(source).toContain('canEditMember')
    expect(source).toContain('canDeleteMember')
    expect(source).toContain('handleEditMember')
    expect(source).toContain('confirmDeleteMember')
    expect(rosterSection).toContain('+ Add New Member')
    expect(rosterSection).toContain('handleAddTeamMember')
    expect(rosterSection).not.toContain('+ Add Team Member')
    expect(source).not.toContain('team-member-select')
    expect(source).not.toContain('handleTeamMemberSelect')
    expect(source).toContain('teamSectionRef')
    expect(source).toContain("scrollIntoView({ behavior: 'smooth', block: 'start' })")
    expect(source).toContain('/api/team-member-profiles')
  })

  it('shows member edit card with contextual save placement and team-member-only roles', () => {
    const source = readProfileSource()
    const memberCard = memberEditCardSlice(source)

    expect(source).toContain('memberEditCardTitle')
    expect(source).toContain('memberEditSaveButtonLabel')
    expect(source).toContain('shouldShowMemberSaveInCardHeader')
    expect(source).toContain('memberEditSaveDisabled')
    expect(source).toContain('New Team Member')
    expect(memberCard).toContain('{saveButtonLabel}')
    expect(memberCard).toContain('type="submit"')
    expect(memberCard).toContain('{showMemberSaveInHeader && (')
    expect(memberCard).toMatch(/UserRolesCheckboxGrid[\s\S]*!\s*showMemberSaveInHeader/)
    expect(memberCard).not.toContain('>User Roles</h2>')
    expect(memberCard).toContain('{showUserRolesSection && (')
    expect(memberCard).toContain('UserRolesCheckboxGrid')
    expect(memberCard).toContain('getTeamMemberRolesHelperText')
    expect(memberCard).not.toContain('Select your roles. Choose Owner / Admin to set up your carrier organization.')
  })

  it('hides standalone User Roles section on own profile and shows Owner/Admin badge on landing', () => {
    const source = readProfileSource()
    const carrierCard = carrierCardSlice(source)
    const memberProfileSource = readFileSync(memberProfilePath, 'utf8')

    expect(memberEditCardSlice(source)).toContain('{showUserRolesSection && (')
    expect(source).not.toMatch(/<h2[^>]*>User Roles<\/h2>/)
    expect(source).toContain('shouldShowOwnerAdminBadge')
    expect(source).toContain('showOwnerAdminBadge')
    expect(source).toContain('ownerAdminBadgeRole')
    expect(carrierCard).toContain('You are')
    expect(carrierCard).toContain('roleBadgeClass(ownerBadgeRole)')
    // Owner Operator exception: Operator badge from acting SSoT (§4.1).
    expect(carrierCard).toContain('showOperatorBadge')
    expect(carrierCard).toContain('Operator')
    expect(source).toContain('const showOperatorBadge = homeActingActor.isOwnerOperator')
    expect(source).toContain('resolveActingRolesFromInputs')
    expect(source).toContain('homeActingActor')
    expect(source).toContain('actingPermissionActor')
    expect(source).toContain('fetchOrganizationMembershipForOrg')
    // Home membership loaded on successful profile path (not nulled).
    expect(source).toMatch(
      /fetchOrganizationMembershipForOrg\(\s*supabase,\s*session\.user\.id,\s*loadedProfile\.organization_id/
    )
    expect(source).not.toMatch(
      /setOwnProfile\(loadedProfile\)[\s\S]{0,200}setOrganizationMembership\(null\)/
    )
    // Handlers/gates use acting SSoT for home write/manage.
    expect(source).toContain('canWriteTeamData(actingPermissionActor)')
    expect(source).toContain('canManageMemberPermissions(actingPermissionActor)')
    expect(source).toContain('canEditMember(actingPermissionActor')
    expect(source).toContain('shouldShowUserRolesSection')
    expect(source).toContain('showUserRolesSection')
    expect(source).toContain('shouldShowAssignedRoleBadges')
    expect(source).toContain('Your assigned roles:')
  })

  it('auto-assigns bootstrap Owner roles on mount and carrier save', () => {
    const source = readProfileSource()
    const carrierHandler = handleSaveCarrierInfoSlice(source)

    expect(source).toContain('ensureBootstrapOwnerRoles')
    expect(source).toContain('isForcedCarrierOwner')
    expect(source).toMatch(
      /useEffect\(\(\) => \{[\s\S]*if \(loading\) return[\s\S]*needsPrimaryOwnerBootstrap[\s\S]*setFormState\(ensureBootstrapOwnerRoles\(formRef\.current\), true\)/
    )
    expect(source).not.toMatch(
      /if \(!ownProfile \|\| isForcedCarrierOwner\(user\?\.email\)\) \{[\s\S]*setFormState\(ensureBootstrapOwnerRoles/
    )
    expect(carrierHandler).toMatch(
      /const formSnapshot = isProfileBootstrap[\s\S]*ensureBootstrapOwnerRoles\(\{[\s\S]*user_roles: \[\.\.\.form\.user_roles\]/
    )
  })

  it('renders unified owner bootstrap setup card with contact fields and Owner Operator toggle', () => {
    const source = readProfileSource()
    const bootstrapCard = bootstrapSetupCardSlice(source)

    expect(source).toContain('shouldShowOwnerBootstrapSetupCard')
    expect(source).toContain('showOwnerBootstrapSetup')
    expect(source).toContain('getBootstrapWelcomeTitle')
    expect(source).toContain('bootstrapWelcomeTitle')
    expect(source).toContain('BOOTSTRAP_CONTACT_FIELDS')
    expect(source).toContain('BOOTSTRAP_CARRIER_FIELDS')
    expect(source).toContain('toggleOwnerOperator')
    expect(source).toContain('isOwnerOperatorSelected')
    expect(source).toContain('validateBootstrapSelfSave')
    expect(bootstrapCard).toContain('onSubmit={handleSave}')
    expect(bootstrapCard).toContain('bootstrapWelcomeTitle')
    expect(bootstrapCard).toContain('bootstrapWelcomeSubtitle')
    expect(bootstrapCard).toContain('BOOTSTRAP_CONTACT_FIELDS')
    expect(bootstrapCard).toContain('BOOTSTRAP_CARRIER_FIELDS')
    expect(bootstrapCard).toContain('checked={ownerOperatorSelected}')
    expect(bootstrapCard).toContain('isFieldDisabled(key)')
    expect(source).toMatch(/BOOTSTRAP_CONTACT_FIELDS[\s\S]*Full Name/)
    expect(source).toMatch(/BOOTSTRAP_CONTACT_FIELDS[\s\S]*Company Phone/)
    expect(source).toMatch(/BOOTSTRAP_CONTACT_FIELDS[\s\S]*Cell Phone/)
    expect(bootstrapCard).toContain('Owner Operator')
    expect(bootstrapCard).toContain('getOwnerBootstrapOwnerOperatorHint')
    expect(bootstrapCard).toContain('disabled={isSaving || isLoadingMember}')
    expect(source).toMatch(
      /const editingLabel[\s\S]*showOwnerBootstrapSetup[\s\S]*\? null/
    )
    expect(bootstrapCard).toContain('bootstrapSaveButtonLabel')
    expect(bootstrapCard).not.toContain('Your Profile')
    expect(source).toMatch(/shouldShowCarrierInformationCard\([\s\S]*isProfileBootstrap,\s*\n\s*form/)
    expect(source).not.toMatch(/isProfileBootstrap \|\| forcedCarrierOwner/)
    expect(source).toContain('{!showOwnerBootstrapSetup && (')
    expect(carrierCardSlice(source)).not.toContain('setting up as Owner')
    // Role-aware welcome + guided post-bootstrap path
    expect(source).toContain('resolveOnboardingPersona')
    expect(source).toContain('showGuidedNextSteps')
    expect(source).toContain('roleWelcomeHeadline')
    expect(source).toContain('hasOrgEquipment')
    expect(source).toContain('orgMemberProfileCount')
    expect(source).toContain('writeOnboardingGuidedDismissed')
    expect(source).toContain('showFullWelcomeBanner')
    expect(source).toContain('contextLoadFailed')
    expect(source).toMatch(/from\('equipment_profiles'\)[\s\S]*organization_id/)
    expect(source).toContain('writeOnboardingGuidedDismissed(user.id, true)')
    expect(source).toMatch(/if \(contextLoadFailed\) return/)
    expect(source).toContain('shouldShowTeamRoleWelcome')
  })

  it('routes all profile saves through the team-member-profiles API', () => {
    const source = readProfileSource()

    expect(source).toContain('buildSavePayloadForTarget')
    expect(source).toContain('buildMemberProfileSavePayloadWithoutCarrier')
    expect(source).toContain('buildSelfMemberSavePayload')
    expect(source).not.toContain('prepareMemberProfileSave')
    expect(source).toContain('setFormState(memberProfileFromRow(profile))')
    expect(source).toContain("setEditingTarget({ kind: 'self' })")
    expect(source).toContain('roleBadgeClass')
    expect(source).toContain('driver_summary')
  })

  it('shows editing banner from list display name and fetches profile on cache miss', () => {
    const source = readProfileSource()

    expect(source).toContain('editingDisplayName')
    expect(source).toContain('setEditingDisplayName(displayName)')
    expect(source).toContain("async function handleEditMember")
    expect(source).toContain(".from('member_profiles')")
    expect(source).toContain(".from('team_member_profiles')")
    expect(source).toContain('fetchActorTeamContext')
    expect(source).toMatch(
      /fetchActorTeamContext\([\s\S]*resolveActorProfile\([\s\S]*needsPrimaryOwnerBootstrap/
    )
    expect(source).toContain('hydratedActorProfile')
    expect(source).toMatch(
      /shouldBootstrap[\s\S]*ensureBootstrapOwnerRoles\(initialForm\)[\s\S]*else if \(actorProfile\)/
    )
    expect(source).toContain('linkedRosterProfile')
    expect(source).toContain('resolveActorProfile')
    expect(source).toContain('.maybeSingle()')
    expect(source).toMatch(/handleEditMember[\s\S]*resetToSelfForm\(\)/)
  })

  it('highlights active editing row and uses contextual save labels', () => {
    const source = readProfileSource()

    expect(source).toContain('editingMemberKey')
    expect(source).toContain('memberListKey')
    expect(source).toContain('isEditingRow')
    expect(source).toContain('bg-blue-50')
    expect(source).toContain('saveButtonLabel')
    expect(source).toContain('memberEditSaveButtonLabel')
  })

  it('confirms delete, refreshes team list, and shows update success for others', () => {
    const source = readProfileSource()

    expect(source).toContain('deleteCandidate')
    expect(source).toContain('confirmDeleteMember')
    expect(source).toContain('Delete team member?')
    expect(source).toContain('await loadTeamData(supabase, user.id, effectiveOwnProfile)')
    expect(source).toContain('Updated ${updatedName} successfully.')
    expect(source).toContain('New team member saved.')
    expect(source).toContain('Profile saved successfully.')
  })

  it('shows read-only carrier summary after first save with edit toggle for carrier managers', () => {
    const source = readProfileSource()
    const carrierCard = carrierCardSlice(source)
    const showEditCarrierButtonGuard = source.slice(
      source.indexOf('const showEditCarrierButton'),
      source.indexOf('const showSaveCarrierInfoButton')
    )
    const showSaveCarrierInfoButtonGuard = source.slice(
      source.indexOf('const showSaveCarrierInfoButton'),
      source.indexOf('const isLoadingMember')
    )

    expect(source).toContain('carrierFormExpanded')
    expect(source).toContain('setCarrierFormExpanded')
    expect(source).toContain('formatCarrierSummaryDisplay')
    expect(source).toContain('shouldUseCarrierSummaryMode')
    expect(source).toContain('shouldShowCarrierForm')
    expect(source).toContain('showCarrierForm')
    expect(source).toContain('carrierSummaryFields')
    expect(source).toContain('Edit Carrier Info')
    expect(source).toContain('handleCollapseCarrier')
    expect(source).toContain('showEditCarrierButton')
    expect(source).toContain("editingTarget.kind === 'self'")
    expect(source).toContain('const canManageCarrier = canSaveCarrierInfo(effectiveOwnProfile, form, actorEmail)')
    expect(showEditCarrierButtonGuard).toContain('canManageCarrier')
    expect(showEditCarrierButtonGuard).toContain('forcedCarrierOwner')
    expect(showEditCarrierButtonGuard).toMatch(/\(canWriteProfile \|\| forcedCarrierOwner\)/)
    const memberCard = memberEditCardSlice(source)
    expect(memberCard).toMatch(/disabled=\{memberSaveDisabled\}/)
    expect(source).toContain('memberEditSaveDisabled')
    expect(source).toMatch(
      /function isFieldDisabled[\s\S]*isForcedCarrierOwner\(user\?\.email\)[\s\S]*\(!canWriteProfile && !forcedOwner\)/
    )
    expect(showSaveCarrierInfoButtonGuard).toContain('canManageCarrier')
    expect(source).toMatch(/<dl className="grid/)
    expect(carrierCard).toContain('onClick={handleCollapseCarrier}')
    expect(carrierCard).toContain('canManageCarrier && carrierSummaryMode')
    expect(carrierCard).toContain('Collapse')
    expect(carrierCard).not.toMatch(/carrierFormExpanded \? 'Collapse' : 'Expand'/)
    expect(carrierCard).not.toMatch(/primaryOwner && carrierSummaryMode/)
  })

  it('places Save Carrier Info inside the carrier card with carrier-only payload and scoped feedback', () => {
    const source = readProfileSource()
    const carrierCard = carrierCardSlice(source)
    const carrierHandler = handleSaveCarrierInfoSlice(source)

    expect(carrierCard).toContain('Save Carrier Info')
    expect(carrierCard).toContain('handleSaveCarrierInfo')
    const saveCarrierButtonGuard = source.slice(
      source.indexOf('const showSaveCarrierInfoButton'),
      source.indexOf('const isLoadingMember')
    )
    expect(saveCarrierButtonGuard).not.toContain('canWriteProfile')
    expect(carrierCard).toContain('carrierMessage')
    expect(source).toContain('Carrier information saved.')
    expect(source).toContain('buildCarrierOnlyApiSavePayload')
    expect(source).toContain('mergeCarrierFieldsOntoProfile')
    expect(source).toContain('refreshOwnProfileAfterSave')
    expect(source).toContain('resolveRefreshedOwnProfile')
    expect(source).toContain('profileFromSaveResponse')
    expect(source).toContain('savedProfile')
    expect(source).toContain("save_scope: 'carrier_only'")
    expect(source).toMatch(/<form onSubmit=\{handleSaveCarrierInfo\}/)
    expect(carrierHandler).toMatch(/setFormState\(memberProfileFromRow\(profile\)\)/)
    expect(carrierHandler).toMatch(/await loadTeamData\(supabase, user\.id, profile\)/)
    expect(carrierHandler).toContain('Failed to save carrier information.')
  })

  it('shows read-only org carrier block with expand collapse in member edit card', () => {
    const memberCard = memberEditCardSlice(readProfileSource())
    const source = readProfileSource()

    expect(source).toContain('showTeamSectionCarrier')
    expect(source).toContain('resolveCarrierDataSource')
    expect(source).toContain('teamSectionCarrierSource')
    expect(source).toContain('shouldShowTeamSectionCarrierDetails')
    expect(source).toContain('teamSectionCarrierFields')
    expect(source).toContain('getTeamSectionCarrierHelperText')
    expect(memberCard).toContain("carrierFormExpanded ? 'Collapse' : 'Expand'")
    expect(memberCard).not.toContain('id={`team-${key}`}')
    expect(memberCard).toContain('teamSectionCarrierFields')
    expect(memberCard).toContain('getTeamSectionCarrierHelperText')
  })

  it('adds team members as child roster rows under parent carrier without bootstrap UI', () => {
    const source = readProfileSource()
    const addHandler = source.slice(
      source.indexOf('function handleAddTeamMember'),
      source.indexOf('async function submitRestrictedFieldChangeRequests')
    )
    const savePayload = source.slice(
      source.indexOf('function buildSavePayloadForTarget'),
      source.indexOf('async function handleSaveCarrierInfo')
    )

    expect(addHandler).toContain("setEditingTarget({ kind: 'team_member_profile', id: null })")
    expect(addHandler).toContain('buildMemberProfileSavePayloadWithoutCarrier')
    expect(addHandler).toContain('emptyMemberProfileForm()')
    expect(addHandler).not.toContain('ensureBootstrapOwnerRoles')
    expect(addHandler).not.toContain('generateOrganizationId')

    expect(savePayload).toMatch(
      /team_member_profile[\s\S]*source: 'team_member_profile'[\s\S]*buildMemberProfileSavePayloadWithoutCarrier/
    )
    expect(source).toContain('ASSIGNABLE_TEAM_ROLES')
    expect(source).toContain('shouldShowCarrierForm')
    expect(source).toContain('shouldShowCarrierInformationCard')
    expect(source).toContain('shouldShowOwnerBootstrapSetupCard')
    // Carrier Information / Owner bootstrap never gate on team_member_profile targets
    expect(source).toMatch(/shouldShowCarrierForm\(\s*editingTarget/)
    expect(source).toMatch(/shouldShowCarrierInformationCard\(\s*\n\s*editingTarget/)
    expect(source).toContain('getMemberEditCardSubtitle')
  })

  it('enforces viewer write restrictions and role edit permissions in UI', () => {
    const source = readProfileSource()

    expect(source).toContain('canWriteTeamData')
    expect(source).toContain('canWriteProfile')
    expect(source).toContain('canSelfEditRoles')
    expect(source).toContain('canEditRoles')
    expect(source).toContain('canManageMemberPermissions')
    expect(source).toMatch(/disabled=\{!canEditRoles/)
    expect(source).toContain('isFieldDisabled')
  })

  it('shows team member permission editor with global/custom toggles', () => {
    const source = readProfileSource()

    expect(source).toContain('MemberPermissionsEditor')
    expect(source).toContain("mode === 'global' ? 'Global' : 'Custom'")
    expect(source).toContain('memberPermissions')
    expect(source).toContain('canEditMemberPermissions')
    expect(source).toContain('ASSIGNABLE_TEAM_ROLES')
    expect(source).toMatch(/const teamRoleOptions\s*=\s*ASSIGNABLE_TEAM_ROLES/)
    expect(source).toContain('roleOptions={teamRoleOptions}')
    expect(source).toContain('organization_memberships')
    expect(source).toContain('CUSTOM_PERMISSION_AREAS')
  })

  it('gates toggleRole with canEditRoles predicate (Admin team assign + self primary)', () => {
    const source = readProfileSource()
    const toggleSlice = source.slice(
      source.indexOf('function toggleRole'),
      source.indexOf('function toggleOwnerOperator')
    )

    // Must not require primary-only canSelfEditRoles for team-member role edits
    expect(toggleSlice).toContain("editingTarget.kind !== 'self'")
    expect(toggleSlice).toContain('canManageMemberPermissions(actingPermissionActor)')
    expect(toggleSlice).toContain('canSelfEditRoles(effectiveOwnProfile)')
    expect(toggleSlice).toMatch(
      /editingTarget\.kind !== 'self'[\s\S]*canManageMemberPermissions[\s\S]*canSelfEditRoles/
    )
    expect(source).toMatch(
      /const canEditRoles\s*=\s*\n?\s*editingTarget\.kind !== 'self'\s*\n?\s*\? canManageMemberPermissions/
    )
    expect(source).toMatch(
      /shouldShowOwnerBootstrapSetupCard\(\s*editingTarget,\s*isProfileBootstrap\s*\)/
    )
  })

  it('implements driver restricted field permissions and change request flow', () => {
    const source = readProfileSource()
    const saveHandler = handleSaveSlice(source)

    expect(source).toContain('profile-field-permissions')
    expect(source).toContain('isDriverSelfServiceActor')
    expect(source).toContain('showDriverRestrictedWarning')
    expect(source).toContain('Requires Admin approval')
    expect(source).toContain('submitRestrictedFieldChangeRequests')
    expect(source).toContain('/api/profile-change-requests')
    expect(source).toContain('applyDriverRestrictedFieldBaseline')
    expect(source).toContain('pending approval')
    expect(source).toContain('pendingProfileChangeFieldKeys')
    expect(source).toContain('persistedProfileBaseline')
    expect(source).toContain('memberProfileFromRow(effectiveOwnProfile)')
    expect(source).toContain('buildRestrictedChangeRequestPayload')
    expect(source).not.toContain('baseline_profile')
    expect(saveHandler).toMatch(
      /applyDriverRestrictedFieldBaseline\([\s\S]*memberProfileFromRow\(effectiveOwnProfile\)[\s\S]*buildSavePayloadForTarget\(priorTarget, formForSave/
    )
    expect(saveHandler).toMatch(/submittedChangeCount[\s\S]*submitted for admin review/)
    expect(saveHandler).toMatch(/saveViaApi\(accessToken, savePayload\)[\s\S]*submitRestrictedFieldChangeRequests/)
    expect(saveHandler).toMatch(/createdNewRosterMember[\s\S]*setEditingTarget\(\{ kind: 'self' \}\)/)
  })

  it('uses showLandingView for roster spacing and delegates isFieldDisabled to canEditProfileField', () => {
    const source = readProfileSource()
    const rosterSection = teamRosterSectionSlice(source)

    expect(source).toContain('const showLandingView = shouldShowLandingProfileView')
    expect(rosterSection).toContain('${showLandingView ?')
    expect(source).toMatch(
      /function isFieldDisabled\(key: ProfileFieldKey\): boolean \{[\s\S]*return !canEditProfileField\(effectiveOwnProfile, key\)/
    )
  })

  it('shows driver pending changes list with withdraw action', () => {
    const source = readProfileSource()

    expect(source).toContain('Your Pending Profile Changes')
    expect(source).toContain('withdrawOwnProfileChangeRequest')
    expect(source).toContain('Pending profile change withdrawn.')
    expect(source).toContain('withdrawingChangeRequestId')
  })

  it('uses shouldShowLandingProfileView for editingLabel and avoids undefined helper typo', () => {
    const source = readProfileSource()

    expect(source).not.toContain('showLandingProfileView(')
    expect(source).toMatch(/const editingLabel[\s\S]*shouldShowLandingProfileView\(/)
  })

  it('shows global save feedback banner outside member edit card', () => {
    const source = readProfileSource()
    const memberCard = memberEditCardSlice(source)
    const globalSaveIdx = source.indexOf('{saveMessage && (')
    const memberEditIdx = source.indexOf('{showMemberEditCard && (')

    expect(globalSaveIdx).toBeGreaterThan(-1)
    expect(globalSaveIdx).toBeLessThan(memberEditIdx)
    expect(memberCard).not.toContain('{saveMessage && (')
  })

  it('shows driver edit-my-profile action and admin pending profile changes UI', () => {
    const source = readProfileSource()

    expect(source).toContain('shouldShowEditMyProfileOnLanding')
    expect(source).toContain('Edit my profile')
    expect(source).toContain('handleEditMyProfile')
    expect(source).toContain('Pending Profile Changes')
    expect(source).toContain('respondToProfileChangeRequest')
    expect(source).toContain("method: 'PATCH'")
    expect(source).toContain('/api/profile-change-requests')
  })

  it('shows account link requests for primary owners with approve and reject actions', () => {
    const source = readProfileSource()

    expect(source).toContain('Account Link Requests')
    expect(source).toContain('incomingLinkRequests')
    expect(source).toContain('/api/carrier-link-requests?direction=incoming')
    expect(source).toContain("respondToLinkRequest(request.id, 'approve')")
    expect(source).toContain("respondToLinkRequest(request.id, 'reject')")
  })

  it('resets carrier form expansion when switching edit targets or saving', () => {
    const source = readProfileSource()

    expect(source).toContain('setCarrierFormExpanded(false)')
    expect(source).toMatch(/resetToSelfForm[\s\S]*setCarrierFormExpanded\(false\)/)
    expect(source).toMatch(/handleEditMember[\s\S]*setCarrierFormExpanded\(false\)/)
    expect(source).toMatch(/handleSave[\s\S]*setCarrierFormExpanded\(false\)/)
    expect(source).toMatch(/handleSaveCarrierInfo[\s\S]*setCarrierFormExpanded\(false\)/)
    expect(source).toMatch(/handleAddTeamMember[\s\S]*setCarrierFormExpanded\(false\)/)
    expect(source).toContain('confirmDiscardCarrierIfDirty')
  })

  it('uses separate saving flags with mutual exclusion across save actions', () => {
    const source = readProfileSource()
    const carrierCard = carrierCardSlice(source)
    const carrierHandler = handleSaveCarrierInfoSlice(source)

    expect(source).toContain('savingCarrier')
    expect(source).toContain('savingProfile')
    expect(source).toContain('setSavingCarrier')
    expect(source).toContain('setSavingProfile')
    expect(source).toContain('isAnySaveInFlight')
    expect(source).toContain('const isSaving = isAnySaveInFlight(savingCarrier, savingProfile)')
    expect(carrierHandler).toMatch(/if \(!user \|\| editingTarget\.kind !== 'self'\) return/)
    expect(carrierHandler).toMatch(
      /if \(!forcedCarrierOwner && !canWriteTeamData\(actingPermissionActor\)\) return/
    )
    expect(carrierHandler).toMatch(
      /if \(!canSaveCarrierInfo\(effectiveOwnProfile, formSnapshot, actorEmail\)\) \{[\s\S]*CARRIER_SAVE_FORBIDDEN_MESSAGE/
    )
    expect(source).toContain('canSaveCarrierInfo')
    expect(carrierHandler).toMatch(/if \(savingCarrier \|\| savingProfile\) return/)
    expect(source).toMatch(/async function handleSave[\s\S]*if \(savingCarrier \|\| savingProfile\) return/)
    expect(handleSaveSlice(source)).toMatch(
      /if \(!user \|\| \(!forcedCarrierOwner && !canWriteTeamData\(actingPermissionActor\)\)\) return/
    )
    expect(source).toContain('const carrierSaveInFlight = savingCarrier || savingProfile')
    expect(carrierCardSlice(source)).toContain('disabled={carrierSaveInFlight}')
    expect(carrierCard).toMatch(/Edit Carrier Info[\s\S]*disabled=\{carrierSaveInFlight\}/)
    expect(carrierCard).toMatch(/Collapse[\s\S]*disabled=\{carrierSaveInFlight\}/)
    expect(carrierCardSlice(source)).not.toContain('disabled={isSaving}')
    expect(source).toContain("{savingCarrier ? 'Saving...' : 'Save Carrier Info'}")
    expect(source).toMatch(/saveButtonLabel[\s\S]*savingProfile/)
    expect(carrierHandler).toContain('logCarrierSaveDebug')
    expect(carrierHandler).toContain('logCarrierSaveWarn')
    expect(source).toContain('logCarrierSaveDebug')
    expect(carrierHandler).toMatch(
      /async function handleSaveCarrierInfo[\s\S]*const formSnapshot = isProfileBootstrap[\s\S]*setSavingCarrier\(true\)/
    )
    expect(carrierHandler).toContain('validateBootstrapCarrierSaveRoles')
    expect(carrierHandler).toMatch(/if \(!forcedCarrierOwner && roleCheck\.ok === false\)/)
    expect(carrierHandler).toMatch(
      /buildCarrierOnlyApiSavePayload\(\s*formSnapshot,\s*effectiveOwnProfile,\s*actorEmail/
    )
    expect(carrierHandler).toContain('payloadOrgId: apiPayload.organization_id ?? null')
    expect(carrierHandler).toContain('orgMatch:')
    expect(carrierHandler).toMatch(/orgMatch: wasProfileBootstrap/)
    expect(source).toMatch(
      /function isFieldDisabled[\s\S]*Member\/driver fields use global isSaving/
    )
    expect(source).toMatch(
      /shouldShowMemberEditCard\([\s\S]*editingTarget,[\s\S]*editingMemberKey,[\s\S]*isProfileBootstrap,[\s\S]*effectiveOwnProfile/
    )
  })

  it('refreshes own profile from API response on self-save', () => {
    const saveHandler = handleSaveSlice(readProfileSource())

    expect(saveHandler).toMatch(/priorTarget\.kind === 'self'[\s\S]*savedOwnProfile = result\.savedProfile/)
    expect(saveHandler).toMatch(/refreshOwnProfileAfterSave\(supabase, user\.id, savedOwnProfile\)/)
  })

  it('persists bootstrap via single full save with welcome message', () => {
    const source = readProfileSource()
    const saveHandler = handleSaveSlice(source)
    const apiSource = readTeamMemberProfilesApiSource()

    expect(source).toContain('wasProfileBootstrap')
    expect(source).toContain('validateBootstrapSelfSave')
    expect(source).toContain('validateBootstrapCarrierSaveRoles')
    expect(source).toContain('applyOwnerOperatorRoles')
    expect(saveHandler).toMatch(
      /wasProfileBootstrap && priorTarget\.kind === 'self'[\s\S]*validateBootstrapSelfSave\(form\)/
    )
    expect(saveHandler).toMatch(/submitRestrictedFieldChangeRequests\(accessToken, formForSave\)/)
    expect(saveHandler).toMatch(/if \(!wasProfileBootstrap\) \{[\s\S]*scrollIntoView/)
    expect(saveHandler).toContain("Welcome! Your carrier account is ready.")
    expect(readFileSync(memberProfilePath, 'utf8')).toContain('normalizeBootstrapSelfRoles')
    expect(apiSource).toContain('validateBootstrapCarrierSaveRoles')
    expect(apiSource).toContain('validateBootstrapSelfSave')
    expect(apiSource).toContain('validateBootstrapCarrierOnlySave')
    expect(apiSource).toContain('normalizeBootstrapSelfRoles')
    expect(source).toContain("save_scope: excludeCarrier ? 'member_only' : 'full'")
    expect(source).toContain('shouldShowBootstrapProfilePrompt')
    expect(source).toContain('showBootstrapProfilePrompt')
    expect(source).toContain('session.user.email')
  })

  it('keeps editing team member after save instead of always resetting to self', () => {
    const source = readProfileSource()

    expect(source).toContain('restoreEditingTargetAfterSave')
    expect(source).toContain('priorTarget')
    expect(source).toMatch(/wasEditingOther[\s\S]*restoreEditingTargetAfterSave/)
    expect(source).toContain('createdNewRosterMember')
  })

  it('prompts before discarding unsaved edits when switching members', () => {
    const source = readProfileSource()

    expect(source).toContain('confirmDiscardIfDirty')
    expect(source).toContain('isFormDirty')
    expect(source).toContain('formBaselineRef')
  })

  it('snapshots save payload from prior target before any await in handleSave', () => {
    const source = readProfileSource()
    const saveHandler = source.slice(
      source.indexOf('async function handleSave(e: React.FormEvent, options?: { andInvite?: boolean })')
    )

    expect(source).toMatch(
      /buildSavePayloadForTarget\(\s*target: ProfileEditingTarget = editingTarget[\s\S]*profileSnapshot: MemberProfile \| null = effectiveOwnProfile/
    )
    expect(saveHandler).toMatch(
      /const savePayload = buildSavePayloadForTarget\(priorTarget, formForSave, effectiveOwnProfile\)/
    )
    expect(saveHandler).toMatch(/setSavingProfile\(true\)[\s\S]*await supabase\.auth\.getSession\(\)/)
    expect(saveHandler).toMatch(/saveViaApi\(accessToken, savePayload\)/)
    expect(saveHandler).not.toMatch(/saveViaApi\(accessToken, buildSavePayloadForTarget\(\)\)/)
  })

  it('disables cancel editing while save is in flight', () => {
    const source = readProfileSource()

    expect(source).toMatch(/Cancel editing[\s\S]*disabled=\{isLoadingMember \|\| isSaving\}/)
  })

  it('supports save and invite, re-invite, dev invite testing, and accept-as-current-user', () => {
    const source = readProfileSource()
    const rosterSection = teamRosterSectionSlice(source)
    const memberCard = memberEditCardSlice(source)

    expect(source).toContain('handleSaveAndInvite')
    expect(source).toContain('Save and Invite')
    expect(source).toContain('savingAndInviting')
    expect(source).toContain('sendTeamInviteAfterMemberSave')
    expect(source).toContain('createTeamInviteViaApi')
    expect(memberCard).toContain('showSaveAndInviteButton')
    expect(memberCard).toContain('bg-emerald-600')

    expect(source).toContain('handleReinviteMember')
    expect(source).toContain('canReinviteMember')
    expect(source).toContain('showMemberCardActions')
    expect(source).toMatch(
      /const showMemberCardActions =[\s\S]*editingMember != null[\s\S]*editingTarget\.kind !== 'self'[\s\S]*!isNewTeamMemberTarget\(editingTarget\)/
    )
    expect(memberCard).toContain('Member actions')
    expect(memberCard.indexOf('Member actions')).toBeLessThan(
      memberCard.indexOf('DRIVER_IDENTITY_FIELDS')
    )
    expect(memberCard).toContain('Re-invite')
    expect(memberCard).toContain('allowCardReinvite')
    expect(memberCard).toContain('allowCardDelete')
    expect(memberCard).toContain('Request removal')
    expect(memberCard).toMatch(/'Deleting\.\.\.' : 'Delete'/)
    expect(rosterSection).not.toContain('Re-invite')
    expect(rosterSection).not.toContain('Request removal')
    expect(rosterSection).not.toMatch(/'Deleting\.\.\.' : 'Delete'/)
    expect(rosterSection).toContain('Edit')

    expect(source).toContain('isDevAccountSwitcherEnabled')
    expect(source).toContain('showDevInviteTesting')
    expect(source).toContain('Open accept link')
    expect(source).toContain('Accept as current user')
    expect(source).toContain('acceptInviteAsCurrentUser')
    expect(source).toContain('/api/team-invites/accept')
  })

  it('wires DevAccountSwitcher in AppHeader for dev account switching', () => {
    const headerSource = readFileSync(
      path.join(process.cwd(), 'components', 'AppHeader.tsx'),
      'utf8'
    )
    const switcherSource = readFileSync(
      path.join(process.cwd(), 'components', 'DevAccountSwitcher.tsx'),
      'utf8'
    )

    expect(headerSource).toContain('DevAccountSwitcher')
    expect(switcherSource).toContain('/api/dev/switch-user')
    expect(switcherSource).toContain('isDevAccountSwitcherEnabled')
    expect(switcherSource).toContain('Authorization: `Bearer ${accessToken}`')
    expect(switcherSource).toContain('DEV_BASE_OWNER_EMAIL')
    expect(switcherSource).toContain('Switch back to owner')
    expect(switcherSource).toContain('team_member_profiles')
    expect(switcherSource).toContain('selectValue')
    expect(switcherSource).toContain('canSwitchBackToOwner')
    expect(switcherSource).toContain('removeItem(DEV_TEST_PERSONA_STORAGE_KEY)')
    expect(switcherSource).toContain("eq('linked_user_id', session.user.id)")
    expect(switcherSource).toContain('loadWarning')
    expect(switcherSource).toContain('if (switchingEmail) return')
    expect(switcherSource).toContain('completeDevAccountSwitch')
    expect(switcherSource).toContain('hashed_token')
    expect(switcherSource).toContain('persistDevTestPersonaEmail')
    expect(switcherSource).toContain('window.location.reload()')
    expect(switcherSource).toContain(
      'normalizedCurrentEmail || storedPersona || DEV_BASE_OWNER_EMAIL'
    )

    const handleSwitchSlice = switcherSource.slice(
      switcherSource.indexOf('async function handleSwitch'),
      switcherSource.indexOf('if (!enabled) return null')
    )
    expect(handleSwitchSlice.indexOf('completeDevAccountSwitch')).toBeLessThan(
      handleSwitchSlice.indexOf('persistDevTestPersonaEmail')
    )
    expect(handleSwitchSlice.indexOf('persistDevTestPersonaEmail')).toBeLessThan(
      handleSwitchSlice.indexOf('window.location.reload()')
    )

    expect(headerSource).toContain('clearDevTestPersonaEmail')
    expect(headerSource).toMatch(/clearDevTestPersonaEmail\(\)[\s\S]*signOut\(\)/)
  })

  it('uses error or warning save messages when invite or review submission partially fails', () => {
    const source = readProfileSource()
    const saveHandler = handleSaveSlice(source)

    expect(source).toContain('Promise<{ ok: boolean; text: string }>')
    expect(saveHandler).toContain("finalType: 'success' | 'error' | 'warning'")
    expect(saveHandler).toContain('if (!inviteOutcome.ok)')
    expect(saveHandler).toContain("finalType = 'error'")
    expect(saveHandler).toContain("finalType = 'warning'")
    expect(source).toContain("type: 'success' | 'error' | 'warning'")
    expect(source).toContain('bg-amber-50 text-amber-900')
  })
})