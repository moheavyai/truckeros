import { afterEach, describe, expect, it, vi } from 'vitest'
import { USER_ROLE_OPTIONS } from '@/types/member-profile'
import {
  applySelfSaveScope,
  buildCarrierOnlyApiSavePayload,
  buildCarrierOnlySavePayload,
  canSaveCarrierInfo,
  logCarrierSaveDebug,
  validateBootstrapCarrierSaveRoles,
  buildMemberProfileSavePayloadWithoutCarrier,
  buildSelfMemberSavePayload,
  canSelfEditRoles,
  isAnySaveInFlight,
  memberEditCardTitle,
  memberEditSaveDisabled,
  memberEditSaveButtonLabel,
  shouldShowMemberSaveInCardHeader,
  resolvePersistedRosterId,
  shouldShowBootstrapProfilePrompt,
  shouldShowOwnerBootstrapSetupCard,
  needsPrimaryOwnerBootstrap,
  hasExistingTeamMembership,
  memberProfileFromLinkedRoster,
  resolveActorProfile,
  clampSelfSaveRolesFromTeamContext,
  resolveSelfSaveOrganizationId,
  isOwnerOperatorSelected,
  applyOwnerOperatorRoles,
  prepareBootstrapFormForSave,
  normalizeBootstrapSelfRoles,
  isValidMemberProfileUserRolesCombination,
  validateBootstrapSelfSave,
  validateBootstrapCarrierOnlySave,
  validateBootstrapOptionalEmail,
  validateBootstrapOptionalPhone,
  validateBootstrapEmail,
  BOOTSTRAP_MAX_PHONE_LENGTH,
  BOOTSTRAP_MAX_EMAIL_LENGTH,
  getOwnerBootstrapSetupCardTitle,
  getOwnerBootstrapSetupCardSubtitle,
  getOwnerBootstrapOwnerOperatorHint,
  getOwnerBootstrapSaveButtonLabel,
  carrierFieldsDiffer,
  emptyMemberProfileForm,
  formatCarrierNameSummary,
  formatCarrierSummaryDisplay,
  hasCarrierData,
  memberProfileFromRow,
  memberProfileToUpsertPayload,
  memberProfileToUpsertPayloadWithoutCarrier,
  normalizeCdlState,
  prepareMemberProfileSave,
  resetCarrierFieldsInForm,
  resolveCarrierDataSource,
  shouldBootstrapOrganization,
  shouldShowCarrierForm,
  shouldShowCarrierInformationCard,
  shouldShowEditMyProfileOnLanding,
  shouldShowLandingProfileView,
  shouldShowMemberEditCard,
  shouldShowUserRolesSection,
  shouldShowOwnerAdminBadge,
  shouldShowAssignedRoleBadges,
  getLandingAssignedRoles,
  getMemberEditCardSubtitle,
  getTeamMemberRolesHelperText,
  getTeamSectionCarrierHelperText,
  CARRIER_SAVE_FORBIDDEN_MESSAGE,
  ensureBootstrapOwnerAdminRoles,
  isUserRolesReadOnlyOnProfile,
  getUserRolesSectionHelperText,
  USER_ROLES_HELPER_BOOTSTRAP,
  USER_ROLES_HELPER_MANAGED_BY_OWNER,
  USER_ROLES_HELPER_LANDING_READONLY,
  USER_ROLES_SAVE_WITH_PROFILE_HINT,
  shouldShowTeamSectionCarrierBlock,
  shouldShowTeamSectionCarrierDetails,
  shouldUseCarrierSummaryMode,
  shouldUseTeamMemberCarrierSummary,
  teamMemberProfileFromRow,
  teamMemberProfileToPayload,
  assertAssignableTeamMemberRoles,
  buildTeamMemberChildRosterPayload,
  pickCarrierInheritanceSource,
  rejectNonBootstrapOwnerRoles,
  NON_BOOTSTRAP_OWNER_ROLE_MESSAGE,
  NON_ASSIGNABLE_TEAM_ROLE_MESSAGE,
  TEAM_MEMBER_ROLES_REQUIRED_MESSAGE,
  validateUserRoles,
  generateOrganizationId,
} from './member-profile'

describe('USER_ROLE_OPTIONS', () => {
  it('lists all expected member roles', () => {
    expect(USER_ROLE_OPTIONS).toEqual([
      'Owner',
      'Admin',
      'Driver',
      'Permit Clerk',
      'Viewer',
    ])
  })
})

describe('validateUserRoles', () => {
  it('filters unknown roles and keeps valid selections', () => {
    expect(validateUserRoles(['Driver', 'Invalid', 'Permit Clerk'])).toEqual([
      'Driver',
      'Permit Clerk',
    ])
  })

  it('normalizes legacy Owner / Admin to Admin when isPrimaryOwner is not set', () => {
    expect(validateUserRoles(['Owner / Admin', 'Driver'])).toEqual(['Admin', 'Driver'])
  })

  it('normalizes legacy Owner / Admin to Owner when isPrimaryOwner is true', () => {
    expect(validateUserRoles(['Owner / Admin', 'Driver'], { isPrimaryOwner: true })).toEqual([
      'Owner',
      'Driver',
    ])
  })

  it('normalizes legacy Owner / Admin to Admin when not primary owner', () => {
    expect(validateUserRoles(['Owner / Admin'], { isPrimaryOwner: false })).toEqual(['Admin'])
  })

  it('returns empty array for null or empty input', () => {
    expect(validateUserRoles(null)).toEqual([])
    expect(validateUserRoles([])).toEqual([])
  })

  it('deduplicates valid roles while preserving first occurrence order', () => {
    expect(validateUserRoles(['Driver', 'Driver', 'Permit Clerk', 'Driver'])).toEqual([
      'Driver',
      'Permit Clerk',
    ])
  })
})

describe('rejectNonBootstrapOwnerRoles', () => {
  it('rejects Owner on team member saves', () => {
    expect(() => rejectNonBootstrapOwnerRoles(['Owner', 'Driver'])).toThrow(/bootstrap/i)
  })

  it('allows Admin and other assignable roles', () => {
    expect(() => rejectNonBootstrapOwnerRoles(['Admin', 'Driver'])).not.toThrow()
  })
})

describe('normalizeCdlState', () => {
  it('normalizes valid state codes to uppercase', () => {
    expect(normalizeCdlState('tx')).toBe('TX')
  })

  it('rejects invalid state codes', () => {
    expect(normalizeCdlState('Texas')).toBeNull()
    expect(normalizeCdlState('')).toBeNull()
  })
})

describe('memberProfileFromRow', () => {
  it('maps database row into form defaults', () => {
    const form = memberProfileFromRow({
      user_id: 'user-1',
      company_name: 'Acme Hauling',
      cdl_state: 'CA',
      date_of_birth: '1985-06-15',
      user_roles: ['Driver', 'bogus'],
    })

    expect(form.company_name).toBe('Acme Hauling')
    expect(form.cdl_state).toBe('CA')
    expect(form.date_of_birth).toBe('1985-06-15')
    expect(form.user_roles).toEqual(['Driver'])
    expect(form.usdot_number).toBe('')
  })

  it('returns empty form when row is null', () => {
    expect(memberProfileFromRow(null)).toEqual(emptyMemberProfileForm())
  })

  it('normalizes ISO datetime date_of_birth to YYYY-MM-DD', () => {
    const form = memberProfileFromRow({
      user_id: 'user-1',
      date_of_birth: '1985-06-15T00:00:00.000Z',
    })

    expect(form.date_of_birth).toBe('1985-06-15')
  })
})

describe('memberProfileToUpsertPayload', () => {
  it('trims text fields and normalizes roles for upsert', () => {
    const payload = memberProfileToUpsertPayload(
      {
        ...emptyMemberProfileForm(),
        company_name: '  Acme  ',
        cdl_state: 'ny',
        date_of_birth: '1990-01-01',
        user_roles: ['Viewer', 'Not A Role'],
      },
      'user-abc'
    )

    expect(payload.user_id).toBe('user-abc')
    expect(payload.company_name).toBe('Acme')
    expect(payload.cdl_state).toBe('NY')
    expect(payload.date_of_birth).toBe('1990-01-01')
    expect(payload.user_roles).toEqual(['Viewer'])
    expect(payload.usdot_number).toBeNull()
  })

  it('persists every carrier and driver field on save', () => {
    const payload = memberProfileToUpsertPayload(
      {
        company_name: 'Acme Hauling LLC',
        usdot_number: '1234567',
        mc_number: 'MC-999',
        ein: '12-3456789',
        carrier_address: '100 Main St, Dallas, TX 75201',
        carrier_phone: '555-111-2222',
        carrier_email: 'dispatch@acme.com',
        insurance_contact: 'Jane Agent 555-333-4444',
        driver_full_name: 'John Smith',
        cdl_number: 'D1234567',
        cdl_state: 'TX',
        date_of_birth: '1980-05-15',
        driver_phone: '555-555-6666',
        driver_email: 'john@email.com',
        emergency_contact: 'Mary Smith, spouse, 555-777-8888',
        user_roles: ['Driver', 'Permit Clerk'],
      },
      'user-xyz'
    )

    expect(payload).toMatchObject({
      user_id: 'user-xyz',
      company_name: 'Acme Hauling LLC',
      usdot_number: '1234567',
      mc_number: 'MC-999',
      ein: '12-3456789',
      carrier_address: '100 Main St, Dallas, TX 75201',
      carrier_phone: '555-111-2222',
      carrier_email: 'dispatch@acme.com',
      insurance_contact: 'Jane Agent 555-333-4444',
      driver_full_name: 'John Smith',
      cdl_number: 'D1234567',
      cdl_state: 'TX',
      date_of_birth: '1980-05-15',
      driver_phone: '555-555-6666',
      driver_email: 'john@email.com',
      emergency_contact: 'Mary Smith, spouse, 555-777-8888',
      user_roles: ['Driver', 'Permit Clerk'],
    })
  })
})

describe('shouldBootstrapOrganization', () => {
  it('bootstraps when Owner / Admin is selected and no org exists yet', () => {
    expect(
      shouldBootstrapOrganization(
        { ...emptyMemberProfileForm(), user_roles: ['Owner'] },
        null
      )
    ).toBe(true)
    expect(
      shouldBootstrapOrganization(
        { ...emptyMemberProfileForm(), user_roles: ['Driver'] },
        null
      )
    ).toBe(false)
    expect(
      shouldBootstrapOrganization(
        { ...emptyMemberProfileForm(), user_roles: ['Owner'] },
        { user_id: 'u1', organization_id: 'org-1' }
      )
    ).toBe(false)
  })

  it('bootstraps when primary owner lacks organization_id', () => {
    expect(
      shouldBootstrapOrganization(emptyMemberProfileForm(), {
        user_id: 'u1',
        is_primary_owner: true,
      })
    ).toBe(true)
    expect(
      shouldBootstrapOrganization(emptyMemberProfileForm(), {
        user_id: 'u1',
        is_primary_owner: true,
        organization_id: 'org-1',
      })
    ).toBe(false)
  })
})

describe('prepareMemberProfileSave', () => {
  it('assigns organization and primary owner on first Owner / Admin save', () => {
    const payload = prepareMemberProfileSave(
      { ...emptyMemberProfileForm(), user_roles: ['Owner'], company_name: 'Acme' },
      'user-1',
      null
    )

    expect(payload.user_id).toBe('user-1')
    expect(payload.company_name).toBe('Acme')
    expect(payload.organization_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(payload.is_primary_owner).toBe(true)
  })

  it('preserves existing organization on subsequent saves', () => {
    const payload = prepareMemberProfileSave(
      { ...emptyMemberProfileForm(), user_roles: ['Driver'], company_name: 'Acme' },
      'user-1',
      { user_id: 'user-1', organization_id: 'org-existing', is_primary_owner: true }
    )

    expect(payload.organization_id).toBe('org-existing')
    expect(payload.is_primary_owner).toBe(true)
  })

  it('flows company_name changes through to upsert payload while preserving org', () => {
    const existing = {
      user_id: 'user-1',
      organization_id: 'org-existing',
      is_primary_owner: true,
      company_name: 'Old Carrier LLC',
      user_roles: ['Owner'],
    }
    const form = {
      ...memberProfileFromRow(existing),
      company_name: 'Renamed Carrier LLC',
    }
    const carrierForm = buildCarrierOnlySavePayload(form, existing)
    const payload = prepareMemberProfileSave(carrierForm, 'user-1', existing)

    expect(payload.organization_id).toBe('org-existing')
    expect(payload.company_name).toBe('Renamed Carrier LLC')
    expect(payload.is_primary_owner).toBe(true)
  })

  it('does not promote is_primary_owner on update when existing profile has org but flag was false', () => {
    const existing = {
      user_id: 'user-1',
      organization_id: 'org-existing',
      is_primary_owner: false,
      company_name: 'Carrier LLC',
      user_roles: ['Owner'],
    }
    const form = {
      ...memberProfileFromRow(existing),
      company_name: 'Updated Carrier LLC',
    }
    const carrierForm = buildCarrierOnlySavePayload(form, existing)
    const payload = prepareMemberProfileSave(carrierForm, 'user-1', existing)

    expect(payload.organization_id).toBe('org-existing')
    expect(payload.company_name).toBe('Updated Carrier LLC')
    expect(payload.is_primary_owner).toBeUndefined()
  })

  it('bootstraps organization when primary owner profile lacks organization_id', () => {
    const existing = {
      user_id: 'user-1',
      company_name: 'Partial Profile',
      is_primary_owner: true,
      user_roles: ['Driver'],
    }
    const form = {
      ...memberProfileFromRow(existing),
      company_name: 'New Carrier LLC',
    }
    const payload = prepareMemberProfileSave(form, 'user-1', existing)

    expect(payload.organization_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(payload.is_primary_owner).toBe(true)
    expect(payload.company_name).toBe('New Carrier LLC')
  })

  it('bootstraps organization when profile exists without organization_id and form has Owner / Admin', () => {
    const existing = {
      user_id: 'user-1',
      company_name: 'Partial Profile',
      user_roles: ['Driver'],
    }
    const form = {
      ...memberProfileFromRow(existing),
      company_name: 'New Carrier LLC',
      user_roles: ['Owner'],
    }
    const payload = prepareMemberProfileSave(form, 'user-1', existing)

    expect(payload.organization_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(payload.is_primary_owner).toBe(true)
    expect(payload.company_name).toBe('New Carrier LLC')
  })
})

describe('hasCarrierData', () => {
  it('returns false when profile is missing or all carrier fields are empty', () => {
    expect(hasCarrierData(null)).toBe(false)
    expect(hasCarrierData(undefined)).toBe(false)
    expect(hasCarrierData(emptyMemberProfileForm())).toBe(false)
    expect(hasCarrierData({ user_id: 'u1' })).toBe(false)
  })

  it('returns true when any carrier field has data', () => {
    expect(hasCarrierData({ company_name: 'Acme Hauling' })).toBe(true)
    expect(hasCarrierData({ usdot_number: ' 1234567 ' })).toBe(true)
    expect(hasCarrierData({ insurance_contact: 'Agent Smith' })).toBe(true)
  })
})

describe('formatCarrierNameSummary', () => {
  it('returns trimmed company name or em dash when empty', () => {
    expect(formatCarrierNameSummary({ company_name: 'Acme Hauling LLC' })).toBe('Acme Hauling LLC')
    expect(formatCarrierNameSummary({ company_name: '  Acme Hauling  ' })).toBe('Acme Hauling')
    expect(formatCarrierNameSummary({ company_name: '  ' })).toBe('—')
    expect(formatCarrierNameSummary(null)).toBe('—')
  })
})

describe('shouldShowUserRolesSection', () => {
  it('hides user roles section on own profile landing', () => {
    expect(shouldShowUserRolesSection({ kind: 'self' })).toBe(false)
  })

  it('shows user roles section when editing team members', () => {
    expect(shouldShowUserRolesSection({ kind: 'member_profile', id: 'm1', userId: 'u2' })).toBe(true)
    expect(shouldShowUserRolesSection({ kind: 'team_member_profile', id: 'tm-1' })).toBe(true)
    expect(shouldShowUserRolesSection({ kind: 'team_member_profile', id: null })).toBe(true)
  })
})

describe('shouldShowOwnerAdminBadge', () => {
  const ownerProfile = {
    user_id: 'owner-1',
    is_primary_owner: true,
    user_roles: ['Owner'],
  }

  it('shows badge on landing for primary owners and Owner / Admin role holders', () => {
    expect(shouldShowOwnerAdminBadge(ownerProfile, { kind: 'self' }, true)).toBe(true)
    expect(
      shouldShowOwnerAdminBadge(
        { user_id: 'admin-1', is_primary_owner: false, user_roles: ['Admin'] },
        { kind: 'self' },
        true
      )
    ).toBe(true)
  })

  it('hides badge during bootstrap, active edit, or team member editing', () => {
    expect(shouldShowOwnerAdminBadge(null, { kind: 'self' }, true)).toBe(false)
    expect(shouldShowOwnerAdminBadge(ownerProfile, { kind: 'self' }, false)).toBe(false)
    expect(
      shouldShowOwnerAdminBadge(ownerProfile, { kind: 'member_profile', id: 'm1', userId: 'u2' }, true)
    ).toBe(false)
    expect(
      shouldShowOwnerAdminBadge(
        { user_id: 'driver-1', user_roles: ['Driver'] },
        { kind: 'self' },
        true
      )
    ).toBe(false)
  })
})

describe('shouldShowAssignedRoleBadges', () => {
  it('shows assigned roles on landing for non-admin users', () => {
    expect(
      shouldShowAssignedRoleBadges(
        { user_id: 'driver-1', is_primary_owner: false, user_roles: ['Driver'] },
        { kind: 'self' },
        true
      )
    ).toBe(true)
    expect(
      shouldShowAssignedRoleBadges(
        { user_id: 'driver-1', is_primary_owner: false, user_roles: ['Driver', 'Permit Clerk'] },
        { kind: 'self' },
        true
      )
    ).toBe(true)
  })

  it('hides when Owner / Admin badge is shown or not on landing', () => {
    expect(
      shouldShowAssignedRoleBadges(
        { user_id: 'owner-1', is_primary_owner: true, user_roles: ['Owner'] },
        { kind: 'self' },
        true
      )
    ).toBe(false)
    expect(
      shouldShowAssignedRoleBadges(
        { user_id: 'driver-1', is_primary_owner: false, user_roles: ['Driver'] },
        { kind: 'self' },
        false
      )
    ).toBe(false)
  })
})

describe('getLandingAssignedRoles', () => {
  it('returns validated roles from own profile', () => {
    expect(getLandingAssignedRoles({ user_roles: ['Driver', 'Permit Clerk'] })).toEqual([
      'Driver',
      'Permit Clerk',
    ])
    expect(getLandingAssignedRoles(null)).toEqual([])
  })
})

describe('getMemberEditCardSubtitle', () => {
  it('omits roles from self subtitle and scopes team member edits under the carrier', () => {
    expect(getMemberEditCardSubtitle({ kind: 'self' })).toBe(
      'Update driver details and contacts.'
    )
    expect(
      getMemberEditCardSubtitle({ kind: 'member_profile', id: 'm1', userId: 'u2' })
    ).toBe('Update personal details, contacts, and roles under this carrier.')
    expect(getMemberEditCardSubtitle({ kind: 'team_member_profile', id: null })).toBe(
      'Add personal details and roles under this carrier. No new company setup.'
    )
  })
})

describe('getTeamMemberRolesHelperText', () => {
  it('returns edit or managed-by-owner copy', () => {
    expect(getTeamMemberRolesHelperText(true)).toContain('join this carrier')
    expect(getTeamMemberRolesHelperText(true)).toContain('Permit Clerk')
    expect(getTeamMemberRolesHelperText(true)).toContain('not a new organization')
    expect(getTeamMemberRolesHelperText(false)).toBe(USER_ROLES_HELPER_MANAGED_BY_OWNER)
  })
})

describe('getTeamSectionCarrierHelperText', () => {
  it('marks parent carrier as read-only for team members', () => {
    expect(getTeamSectionCarrierHelperText({ showExpandableSummary: true })).toContain(
      'Parent carrier is shared and read-only'
    )
    expect(getTeamSectionCarrierHelperText({ showExpandableSummary: false })).toContain(
      'team members under this organization'
    )
  })
})

describe('CARRIER_SAVE_FORBIDDEN_MESSAGE', () => {
  it('is a non-empty user-facing error string', () => {
    expect(CARRIER_SAVE_FORBIDDEN_MESSAGE.length).toBeGreaterThan(10)
  })
})

describe('ensureBootstrapOwnerAdminRoles', () => {
  it('adds Owner / Admin when missing and preserves other roles', () => {
    expect(ensureBootstrapOwnerAdminRoles(emptyMemberProfileForm()).user_roles).toEqual([
      'Owner',
    ])
    expect(
      ensureBootstrapOwnerAdminRoles({
        ...emptyMemberProfileForm(),
        user_roles: ['Driver'],
      }).user_roles
    ).toEqual(['Owner', 'Driver'])
  })

  it('does not duplicate Owner / Admin when already present', () => {
    const form = { ...emptyMemberProfileForm(), user_roles: ['Owner', 'Driver'] }
    expect(ensureBootstrapOwnerAdminRoles(form).user_roles).toEqual(['Owner', 'Driver'])
  })
})

describe('isUserRolesReadOnlyOnProfile', () => {
  const selfTarget = { kind: 'self' as const }

  it('is read-only on landing when member edit card is hidden', () => {
    expect(
      isUserRolesReadOnlyOnProfile(selfTarget, {
        showLandingView: true,
        isProfileBootstrap: false,
        showMemberEditCard: false,
      })
    ).toBe(true)
  })

  it('is editable during bootstrap', () => {
    expect(
      isUserRolesReadOnlyOnProfile(selfTarget, {
        showLandingView: false,
        isProfileBootstrap: true,
        showMemberEditCard: true,
      })
    ).toBe(false)
  })

  it('is editable when member edit card is shown on landing', () => {
    expect(
      isUserRolesReadOnlyOnProfile(selfTarget, {
        showLandingView: true,
        isProfileBootstrap: false,
        showMemberEditCard: true,
      })
    ).toBe(false)
  })

  it('is editable during active self edit', () => {
    expect(
      isUserRolesReadOnlyOnProfile(selfTarget, {
        showLandingView: false,
        isProfileBootstrap: false,
        showMemberEditCard: false,
      })
    ).toBe(false)
  })
})

describe('getUserRolesSectionHelperText', () => {
  it('shows landing read-only helper text', () => {
    expect(
      getUserRolesSectionHelperText({
        isProfileBootstrap: false,
        canEditRoles: true,
        isReadOnlyOnLanding: true,
        hasOrganizationId: true,
      })
    ).toBe(USER_ROLES_HELPER_LANDING_READONLY)
  })

  it('shows managed-by-owner helper when roles cannot be edited', () => {
    expect(
      getUserRolesSectionHelperText({
        isProfileBootstrap: false,
        canEditRoles: false,
        isReadOnlyOnLanding: false,
        hasOrganizationId: true,
      })
    ).toBe(USER_ROLES_HELPER_MANAGED_BY_OWNER)
  })

  it('shows bootstrap helper when profile bootstrap and roles are editable', () => {
    expect(
      getUserRolesSectionHelperText({
        isProfileBootstrap: true,
        canEditRoles: true,
        isReadOnlyOnLanding: false,
        hasOrganizationId: false,
      })
    ).toBe(USER_ROLES_HELPER_BOOTSTRAP)
  })

  it('adds Save Profile hint when organization exists', () => {
    expect(
      getUserRolesSectionHelperText({
        isProfileBootstrap: false,
        canEditRoles: true,
        isReadOnlyOnLanding: false,
        hasOrganizationId: true,
      })
    ).toContain(USER_ROLES_SAVE_WITH_PROFILE_HINT)
  })
})

describe('needsPrimaryOwnerBootstrap', () => {
  const rosterRow = {
    id: 'roster-1',
    organization_id: 'org-1',
    created_by_user_id: 'owner-user',
    driver_email: 'driver@example.com',
    user_roles: ['Driver'],
  }

  it('returns true for first-time owner with no profile or team linkage', () => {
    expect(
      needsPrimaryOwnerBootstrap({
        actorEmail: 'owner@example.com',
        ownProfile: null,
      })
    ).toBe(true)
  })

  it('returns false when user has a member profile with organization', () => {
    expect(
      needsPrimaryOwnerBootstrap({
        ownProfile: {
          user_id: 'driver-user',
          organization_id: 'org-1',
          user_roles: ['Driver'],
        },
      })
    ).toBe(false)
  })

  it('returns false for roster-linked team member without member_profiles row', () => {
    expect(
      needsPrimaryOwnerBootstrap({
        actorEmail: 'driver@example.com',
        ownProfile: null,
        linkedRoster: rosterRow,
      })
    ).toBe(false)
  })

  it('returns false for organization membership without member_profiles row', () => {
    expect(
      needsPrimaryOwnerBootstrap({
        ownProfile: null,
        organizationMembership: { organization_id: 'org-1', role: 'Admin' },
      })
    ).toBe(false)
  })

  it('keeps forced owner bootstrap only when not already on a team', () => {
    expect(
      needsPrimaryOwnerBootstrap({
        actorEmail: 'andrehampton1@outlook.com',
        ownProfile: null,
      })
    ).toBe(true)
    expect(
      needsPrimaryOwnerBootstrap({
        actorEmail: 'andrehampton1@outlook.com',
        ownProfile: null,
        linkedRoster: rosterRow,
      })
    ).toBe(false)
  })
})

describe('resolveActorProfile', () => {
  it('hydrates a roster-linked actor for landing permissions', () => {
    const profile = resolveActorProfile(
      null,
      {
        id: 'roster-1',
        organization_id: 'org-1',
        created_by_user_id: 'owner-user',
        driver_full_name: 'Dana Driver',
        user_roles: ['Driver'],
      },
      'driver-user'
    )

    expect(profile).toMatchObject({
      user_id: 'driver-user',
      organization_id: 'org-1',
      driver_full_name: 'Dana Driver',
      user_roles: ['Driver'],
      is_primary_owner: false,
    })
  })

  it('hydrates from organization_memberships when roster is unavailable', () => {
    const profile = resolveActorProfile(
      null,
      null,
      'admin-user',
      { organization_id: 'org-9', role: 'Admin' }
    )

    expect(profile).toMatchObject({
      user_id: 'admin-user',
      organization_id: 'org-9',
      user_roles: ['Admin'],
      is_primary_owner: false,
    })
  })

  it('prefers persisted member_profiles over roster hydration', () => {
    const ownProfile = {
      user_id: 'driver-user',
      organization_id: 'org-1',
      user_roles: ['Admin'],
      is_primary_owner: false,
    }

    expect(
      resolveActorProfile(
        ownProfile,
        {
          id: 'roster-1',
          organization_id: 'org-1',
          created_by_user_id: 'owner-user',
          user_roles: ['Driver'],
        },
        'driver-user'
      )
    ).toBe(ownProfile)
  })
})

describe('clampSelfSaveRolesFromTeamContext', () => {
  it('replaces escalated client roles with roster roles', () => {
    const result = clampSelfSaveRolesFromTeamContext(
      { ...emptyMemberProfileForm(), user_roles: ['Owner'] },
      {
        id: 'roster-1',
        organization_id: 'org-1',
        created_by_user_id: 'owner-user',
        user_roles: ['Admin'],
      }
    )

    expect(result.user_roles).toEqual(['Admin'])
  })

  it('uses membership role when roster row is missing', () => {
    const result = clampSelfSaveRolesFromTeamContext(
      { ...emptyMemberProfileForm(), user_roles: ['Owner', 'Driver'] },
      null,
      { organization_id: 'org-1', role: 'Driver' }
    )

    expect(result.user_roles).toEqual(['Driver'])
  })
})

describe('resolveSelfSaveOrganizationId', () => {
  it('prefers membership org when profile and roster are absent', () => {
    expect(
      resolveSelfSaveOrganizationId(null, null, { organization_id: 'org-membership', role: 'Admin' })
    ).toBe('org-membership')
  })
})

describe('hasExistingTeamMembership', () => {
  it('detects roster or membership linkage', () => {
    expect(hasExistingTeamMembership({ linkedRoster: null, organizationMembership: null })).toBe(
      false
    )
    expect(
      hasExistingTeamMembership({
        linkedRoster: {
          id: 'r1',
          organization_id: 'org-1',
          created_by_user_id: 'owner',
        },
      })
    ).toBe(true)
  })
})

describe('memberProfileFromLinkedRoster', () => {
  it('maps roster fields onto a synthetic member profile', () => {
    const profile = memberProfileFromLinkedRoster(
      {
        id: 'roster-1',
        organization_id: 'org-1',
        created_by_user_id: 'owner-user',
        company_name: 'Acme Hauling',
        user_roles: ['Admin'],
      },
      'admin-user'
    )

    expect(profile.user_id).toBe('admin-user')
    expect(profile.organization_id).toBe('org-1')
    expect(profile.company_name).toBe('Acme Hauling')
    expect(profile.user_roles).toEqual(['Admin'])
    expect(profile.is_primary_owner).toBe(false)
  })
})

describe('shouldShowCarrierInformationCard', () => {
  it('shows carrier card only for primary owner editing self', () => {
    expect(shouldShowCarrierInformationCard({ kind: 'self' }, true)).toBe(true)
    expect(shouldShowCarrierInformationCard({ kind: 'self' }, false)).toBe(false)
    expect(shouldShowCarrierInformationCard({ kind: 'member_profile', id: 'm1', userId: 'u2' }, true)).toBe(false)
    expect(shouldShowCarrierInformationCard({ kind: 'team_member_profile', id: 'tm-1' }, true)).toBe(false)
  })

  it('hides carrier card during first-visit bootstrap in favor of unified setup card', () => {
    expect(shouldShowCarrierInformationCard({ kind: 'self' }, false, true)).toBe(false)
    expect(shouldShowOwnerBootstrapSetupCard({ kind: 'self' }, true)).toBe(true)
  })

  it('shows carrier card for forced owner with existing profile after bootstrap', () => {
    expect(
      shouldShowCarrierInformationCard(
        { kind: 'self' },
        true,
        false,
        undefined,
        'andrehampton1@outlook.com'
      )
    ).toBe(true)
  })

  it('shows carrier card when Owner / Admin is selected before first carrier save', () => {
    expect(
      shouldShowCarrierInformationCard(
        { kind: 'self' },
        false,
        false,
        { user_roles: ['Owner'] }
      )
    ).toBe(true)
    expect(
      shouldShowCarrierInformationCard({ kind: 'self' }, false, false, { user_roles: ['Driver'] })
    ).toBe(false)
  })
})

describe('shouldShowTeamSectionCarrierBlock', () => {
  it('shows minimized carrier block when editing team members', () => {
    expect(shouldShowTeamSectionCarrierBlock({ kind: 'self' })).toBe(false)
    expect(shouldShowTeamSectionCarrierBlock({ kind: 'member_profile' })).toBe(true)
    expect(shouldShowTeamSectionCarrierBlock({ kind: 'team_member_profile', id: null })).toBe(true)
    expect(shouldShowTeamSectionCarrierBlock({ kind: 'team_member_profile', id: 'tm-1' })).toBe(true)
  })
})

describe('carrier surface mutual exclusivity', () => {
  it.each([
    { target: { kind: 'self' as const }, bootstrap: false, expectCard: true },
    { target: { kind: 'self' as const }, bootstrap: true, expectCard: false },
    {
      target: { kind: 'member_profile' as const, id: 'm1', userId: 'u2' },
      bootstrap: false,
      expectCard: false,
    },
    {
      target: { kind: 'team_member_profile' as const, id: 'tm-1' },
      bootstrap: false,
      expectCard: false,
    },
  ])(
    'shows carrier card or team block for $target.kind (bootstrap=$bootstrap)',
    ({ target, bootstrap, expectCard }) => {
      const showCard = shouldShowCarrierInformationCard(target, true, bootstrap)
      const showBlock = shouldShowTeamSectionCarrierBlock(target)
      const showBootstrap = shouldShowOwnerBootstrapSetupCard(target, bootstrap)

      expect(showCard).toBe(expectCard)
      if (bootstrap && target.kind === 'self') {
        expect(showBootstrap).toBe(true)
        expect(showBlock).toBe(false)
      } else {
        expect(showBlock).toBe(!expectCard)
        expect(showCard !== showBlock).toBe(true)
      }
    }
  )
})

describe('formatCarrierSummaryDisplay', () => {
  it('formats carrier fields with em dash for empty values', () => {
    expect(
      formatCarrierSummaryDisplay({
        company_name: 'Acme Hauling LLC',
        usdot_number: '1234567',
        mc_number: '',
        ein: null as unknown as string,
        carrier_address: '100 Main St',
        carrier_phone: '555-111-2222',
        carrier_email: 'dispatch@acme.com',
        insurance_contact: 'Jane Agent',
      })
    ).toEqual([
      { label: 'Company Name', value: 'Acme Hauling LLC' },
      { label: 'USDOT#', value: '1234567' },
      { label: 'MC#', value: '—' },
      { label: 'EIN', value: '—' },
      { label: 'Address', value: '100 Main St' },
      { label: 'Phone', value: '555-111-2222' },
      { label: 'Email', value: 'dispatch@acme.com' },
      { label: 'Insurance Contact', value: 'Jane Agent' },
    ])
  })

  it('returns all em dashes when source is null', () => {
    const rows = formatCarrierSummaryDisplay(null)
    expect(rows).toHaveLength(8)
    expect(rows.every((row) => row.value === '—')).toBe(true)
  })
})

describe('shouldUseCarrierSummaryMode', () => {
  it('activates summary only when editing self with saved carrier data', () => {
    const carrier = { company_name: 'Acme Hauling' }

    expect(shouldUseCarrierSummaryMode({ kind: 'self' }, carrier)).toBe(true)
    expect(shouldUseCarrierSummaryMode({ kind: 'self' }, emptyMemberProfileForm())).toBe(false)
    expect(shouldUseCarrierSummaryMode({ kind: 'member_profile' }, carrier)).toBe(false)
    expect(shouldUseCarrierSummaryMode({ kind: 'team_member_profile', id: 'tm-1' }, carrier)).toBe(false)
  })
})

describe('resolveCarrierDataSource', () => {
  const orgProfile = {
    user_id: 'owner-1',
    company_name: 'Acme Hauling LLC',
    usdot_number: '1234567',
  }

  it('uses org carrier from ownProfile when editing team members', () => {
    const memberForm = {
      ...emptyMemberProfileForm(),
      driver_full_name: 'Riley Driver',
      company_name: '',
    }

    expect(
      resolveCarrierDataSource(
        { kind: 'member_profile', id: 'm1', userId: 'u2' },
        memberForm,
        orgProfile,
        false
      ).company_name
    ).toBe('Acme Hauling LLC')
  })

  it('uses form carrier while self profile is expanded or dirty', () => {
    const selfForm = {
      ...memberProfileFromRow(orgProfile),
      company_name: 'Edited Carrier Name',
    }

    expect(resolveCarrierDataSource({ kind: 'self' }, selfForm, orgProfile, true).company_name).toBe(
      'Edited Carrier Name'
    )
    expect(resolveCarrierDataSource({ kind: 'self' }, selfForm, orgProfile, false).company_name).toBe(
      'Edited Carrier Name'
    )
  })

  it('uses saved ownProfile carrier when self form matches profile and is collapsed', () => {
    const selfForm = memberProfileFromRow(orgProfile)

    expect(resolveCarrierDataSource({ kind: 'self' }, selfForm, orgProfile, false).company_name).toBe(
      'Acme Hauling LLC'
    )
  })
})

describe('buildCarrierOnlySavePayload', () => {
  it('includes selected roles during first-visit bootstrap saves', () => {
    const form = {
      ...emptyMemberProfileForm(),
      company_name: 'New Carrier LLC',
      user_roles: ['Owner'],
    }

    expect(buildCarrierOnlySavePayload(form, null)).toMatchObject({
      company_name: 'New Carrier LLC',
      user_roles: ['Owner'],
      driver_full_name: '',
    })
  })

  it('preserves form roles when existing profile has no organization_id', () => {
    const existing = {
      user_id: 'owner-1',
      company_name: 'Old Carrier',
      user_roles: ['Driver'],
    }
    const form = {
      ...memberProfileFromRow(existing),
      company_name: 'Updated Carrier',
      user_roles: ['Owner'],
    }

    expect(buildCarrierOnlySavePayload(form, existing).user_roles).toEqual(['Owner'])
  })

  it('does not overwrite roles from form when an existing profile has organization_id', () => {
    const existing = {
      user_id: 'owner-1',
      organization_id: 'org-1',
      company_name: 'Old Carrier',
      user_roles: ['Owner'],
    }
    const form = {
      ...memberProfileFromRow(existing),
      company_name: 'Updated Carrier',
      user_roles: ['Driver'],
    }

    expect(buildCarrierOnlySavePayload(form, existing).user_roles).toEqual(['Owner'])
  })

  it('merges carrier edits with existing non-carrier profile fields', () => {
    const existing = {
      user_id: 'owner-1',
      company_name: 'Old Carrier',
      driver_full_name: 'Owner Name',
      driver_phone: '555-000-1111',
      user_roles: ['Owner'],
    }
    const form = {
      ...memberProfileFromRow(existing),
      company_name: 'New Carrier LLC',
      usdot_number: '9999999',
      driver_full_name: 'Unsaved Driver Edit',
    }

    expect(buildCarrierOnlySavePayload(form, existing)).toMatchObject({
      company_name: 'New Carrier LLC',
      usdot_number: '9999999',
      driver_full_name: 'Owner Name',
      driver_phone: '555-000-1111',
      user_roles: ['Owner'],
    })
  })
})

describe('validateBootstrapCarrierSaveRoles', () => {
  it('auto-accepts bootstrap carrier save via implicit Owner / Admin assignment', () => {
    expect(
      validateBootstrapCarrierSaveRoles(
        { ...emptyMemberProfileForm(), company_name: 'Acme' },
        null
      ).ok
    ).toBe(true)

    expect(
      validateBootstrapCarrierSaveRoles(
        { ...emptyMemberProfileForm(), company_name: 'Acme', user_roles: ['Owner'] },
        null
      ).ok
    ).toBe(true)
  })

  it('skips role validation when an existing profile has organization_id', () => {
    expect(
      validateBootstrapCarrierSaveRoles(
        { ...emptyMemberProfileForm(), user_roles: ['Driver'] },
        { user_id: 'owner-1', organization_id: 'org-1', is_primary_owner: false }
      ).ok
    ).toBe(true)
  })

  it('skips role validation for primary owners without requiring Owner / Admin in form', () => {
    expect(
      validateBootstrapCarrierSaveRoles(
        { ...emptyMemberProfileForm(), user_roles: ['Driver'] },
        { user_id: 'owner-1', is_primary_owner: true }
      ).ok
    ).toBe(true)
  })
})

describe('canSaveCarrierInfo', () => {
  it('allows bootstrap, primary owners, persisted Owner / Admin, and pending bootstrap form roles', () => {
    expect(canSaveCarrierInfo(null, emptyMemberProfileForm())).toBe(true)
    expect(
      canSaveCarrierInfo(
        { is_primary_owner: true, organization_id: 'org-1' },
        emptyMemberProfileForm()
      )
    ).toBe(true)
    expect(
      canSaveCarrierInfo(
        {
          is_primary_owner: false,
          organization_id: 'org-1',
          user_roles: ['Owner'],
        },
        emptyMemberProfileForm()
      )
    ).toBe(true)
    expect(
      canSaveCarrierInfo(
        { is_primary_owner: false },
        { ...emptyMemberProfileForm(), user_roles: ['Owner'] }
      )
    ).toBe(true)
    expect(
      canSaveCarrierInfo(
        {
          is_primary_owner: false,
          organization_id: 'org-1',
          user_roles: ['Driver'],
        },
        { ...emptyMemberProfileForm(), user_roles: ['Driver'] }
      )
    ).toBe(false)
    expect(
      canSaveCarrierInfo(
        { is_primary_owner: false },
        { ...emptyMemberProfileForm(), user_roles: ['Driver'] }
      )
    ).toBe(false)
  })
})

describe('logCarrierSaveDebug', () => {
  it('logs only in development', () => {
    const originalEnv = process.env.NODE_ENV
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    process.env.NODE_ENV = 'development'
    logCarrierSaveDebug('test event', { company_name: 'Acme' })
    expect(logSpy).toHaveBeenCalledWith('[carrier-save] test event', { company_name: 'Acme' })

    logSpy.mockClear()
    process.env.NODE_ENV = 'production'
    logCarrierSaveDebug('test event', { company_name: 'Acme' })
    expect(logSpy).not.toHaveBeenCalled()

    process.env.NODE_ENV = originalEnv
    logSpy.mockRestore()
  })
})

describe('buildCarrierOnlyApiSavePayload', () => {
  it('includes organization_id when existing profile has org', () => {
    const existing = {
      user_id: 'owner-1',
      organization_id: 'org-existing',
      is_primary_owner: true,
      company_name: 'Old Carrier',
      user_roles: ['Owner'],
    }
    const form = {
      ...memberProfileFromRow(existing),
      company_name: 'Updated Carrier Name',
    }

    expect(buildCarrierOnlyApiSavePayload(form, existing)).toMatchObject({
      organization_id: 'org-existing',
      company_name: 'Updated Carrier Name',
      user_roles: ['Owner'],
    })
  })

  it('includes bootstrap organization_id on API payload when no profile exists', () => {
    const form = {
      ...emptyMemberProfileForm(),
      company_name: 'New Carrier LLC',
      user_roles: ['Owner'],
    }

    const apiPayload = buildCarrierOnlyApiSavePayload(form, null)
    expect(apiPayload.organization_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(apiPayload.company_name).toBe('New Carrier LLC')
    expect(apiPayload.user_roles).toEqual(['Owner'])

    const upsertPayload = prepareMemberProfileSave(
      buildCarrierOnlySavePayload(form, null),
      'user-1',
      null
    )
    expect(upsertPayload.organization_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(upsertPayload.company_name).toBe('New Carrier LLC')
  })

  it('auto-assigns Owner / Admin and org on bootstrap even when form roles are empty', () => {
    const form = {
      ...emptyMemberProfileForm(),
      company_name: 'Bootstrap Carrier',
    }

    const apiPayload = buildCarrierOnlyApiSavePayload(form, null)
    expect(apiPayload.user_roles).toEqual(['Owner'])
    expect(apiPayload.organization_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  it('injects bootstrap roles for primary owner profile without organization_id', () => {
    const existing = {
      user_id: 'owner-1',
      is_primary_owner: true,
      company_name: 'Partial Carrier',
      user_roles: ['Driver'],
    }
    const form = { ...memberProfileFromRow(existing), company_name: 'Updated Carrier' }

    const apiPayload = buildCarrierOnlyApiSavePayload(form, existing)
    expect(apiPayload.user_roles).toEqual(['Owner', 'Driver'])
    expect(apiPayload.organization_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })
})

describe('buildMemberProfileSavePayloadWithoutCarrier', () => {
  it('keeps org carrier fields while saving member driver edits', () => {
    const orgProfile = {
      user_id: 'owner-1',
      company_name: 'Acme Hauling LLC',
      usdot_number: '1234567',
    }
    const memberForm = {
      ...emptyMemberProfileForm(),
      driver_full_name: 'Riley Driver',
      company_name: 'Should Not Persist',
    }

    expect(buildMemberProfileSavePayloadWithoutCarrier(memberForm, orgProfile)).toMatchObject({
      driver_full_name: 'Riley Driver',
      company_name: 'Acme Hauling LLC',
      usdot_number: '1234567',
    })
  })
})

describe('assertAssignableTeamMemberRoles', () => {
  it('allows Admin, Driver, Permit Clerk, and Viewer', () => {
    expect(assertAssignableTeamMemberRoles(['Permit Clerk'])).toEqual(['Permit Clerk'])
    expect(assertAssignableTeamMemberRoles(['Admin', 'Driver'])).toEqual(['Admin', 'Driver'])
    expect(assertAssignableTeamMemberRoles(['Viewer'])).toEqual(['Viewer'])
  })

  it('rejects Owner with team-path message (not bootstrap wording)', () => {
    expect(() => assertAssignableTeamMemberRoles(['Owner'])).toThrow(NON_ASSIGNABLE_TEAM_ROLE_MESSAGE)
    expect(() => assertAssignableTeamMemberRoles(['Owner', 'Driver'])).toThrow(
      NON_ASSIGNABLE_TEAM_ROLE_MESSAGE
    )
  })

  it('allows empty/null/undefined roles for partial updates', () => {
    expect(assertAssignableTeamMemberRoles([])).toEqual([])
    expect(assertAssignableTeamMemberRoles(null)).toEqual([])
    expect(assertAssignableTeamMemberRoles(undefined)).toEqual([])
  })
})

describe('pickCarrierInheritanceSource', () => {
  it('prefers actor carrier when present; otherwise primary owner', () => {
    const actorEmpty = { user_id: 'admin-1', organization_id: 'org-1', company_name: '' }
    const actorWith = { user_id: 'admin-1', organization_id: 'org-1', company_name: 'Admin Co' }
    const primary = {
      user_id: 'owner-1',
      organization_id: 'org-1',
      company_name: 'Parent Carrier LLC',
      usdot_number: '999',
    }

    expect(pickCarrierInheritanceSource(actorWith, primary).company_name).toBe('Admin Co')
    expect(pickCarrierInheritanceSource(actorEmpty, primary).company_name).toBe('Parent Carrier LLC')
    expect(pickCarrierInheritanceSource(actorEmpty, null).user_id).toBe('admin-1')
  })
})

describe('buildTeamMemberChildRosterPayload', () => {
  const parentProfile = {
    user_id: 'owner-1',
    organization_id: 'org-parent',
    company_name: 'Parent Carrier LLC',
    usdot_number: '9990001',
    mc_number: 'MC-100',
    is_primary_owner: true,
    user_roles: ['Owner'] as string[],
  }

  it('scopes Permit Clerk under parent organization with inherited carrier fields', () => {
    const form = {
      ...emptyMemberProfileForm(),
      driver_full_name: 'Casey Clerk',
      driver_email: 'casey@example.com',
      company_name: 'Hacker Independent LLC',
      usdot_number: '0000000',
      user_roles: ['Permit Clerk'] as string[],
    }

    const payload = buildTeamMemberChildRosterPayload(form, parentProfile, 'owner-1')

    expect(payload).toMatchObject({
      organization_id: 'org-parent',
      created_by_user_id: 'owner-1',
      linked_user_id: null,
      driver_full_name: 'Casey Clerk',
      driver_email: 'casey@example.com',
      company_name: 'Parent Carrier LLC',
      usdot_number: '9990001',
      mc_number: 'MC-100',
      user_roles: ['Permit Clerk'],
    })
    expect(payload).not.toHaveProperty('is_primary_owner')
    expect(payload.organization_id).not.toBeUndefined()
    expect(payload.organization_id).toBe(parentProfile.organization_id)
  })

  it('includes linked_user_id when provided', () => {
    const payload = buildTeamMemberChildRosterPayload(
      { ...emptyMemberProfileForm(), user_roles: ['Driver'] },
      parentProfile,
      'owner-1',
      'linked-user-9'
    )
    expect(payload.linked_user_id).toBe('linked-user-9')
  })

  it('requires roles on insert when requireRoles is true', () => {
    expect(() =>
      buildTeamMemberChildRosterPayload(
        { ...emptyMemberProfileForm(), user_roles: [] },
        parentProfile,
        'owner-1',
        null,
        { requireRoles: true }
      )
    ).toThrow(TEAM_MEMBER_ROLES_REQUIRED_MESSAGE)
  })

  it('uses explicit carrierSource over parent when provided', () => {
    const adminParent = {
      user_id: 'admin-1',
      organization_id: 'org-parent',
      company_name: '',
    }
    const primaryCarrier = {
      user_id: 'owner-1',
      organization_id: 'org-parent',
      company_name: 'Primary Co',
      usdot_number: '42',
    }
    const payload = buildTeamMemberChildRosterPayload(
      { ...emptyMemberProfileForm(), user_roles: ['Permit Clerk'] },
      adminParent,
      'admin-1',
      null,
      { carrierSource: primaryCarrier }
    )
    expect(payload.company_name).toBe('Primary Co')
    expect(payload.usdot_number).toBe('42')
  })

  it('rejects Owner on roster child payload', () => {
    expect(() =>
      buildTeamMemberChildRosterPayload(
        { ...emptyMemberProfileForm(), user_roles: ['Owner'] },
        parentProfile,
        'owner-1'
      )
    ).toThrow(NON_ASSIGNABLE_TEAM_ROLE_MESSAGE)
  })

  it('requires parent organization_id', () => {
    expect(() =>
      buildTeamMemberChildRosterPayload(
        { ...emptyMemberProfileForm(), user_roles: ['Permit Clerk'] },
        { user_id: 'owner-1', organization_id: null },
        'owner-1'
      )
    ).toThrow(/Organization not configured/)
  })
})

describe('buildSelfMemberSavePayload', () => {
  it('excludes carrier fields for primary owner profile saves', () => {
    const ownProfile = {
      user_id: 'owner-1',
      company_name: 'Acme Hauling LLC',
      is_primary_owner: true,
    }
    const form = {
      ...memberProfileFromRow(ownProfile),
      company_name: 'Edited Carrier',
      driver_full_name: 'Owner Driver',
    }

    expect(
      buildSelfMemberSavePayload(form, ownProfile, { excludeCarrier: true })
    ).toMatchObject({
      company_name: 'Acme Hauling LLC',
      driver_full_name: 'Owner Driver',
    })
  })
})

describe('carrierFieldsDiffer and resetCarrierFieldsInForm', () => {
  it('detects carrier edits and resets them from ownProfile', () => {
    const ownProfile = { user_id: 'owner-1', company_name: 'Acme Hauling LLC' }
    const dirtyForm = { ...memberProfileFromRow(ownProfile), company_name: 'Draft Carrier' }

    expect(carrierFieldsDiffer(dirtyForm, ownProfile)).toBe(true)
    expect(resetCarrierFieldsInForm(dirtyForm, ownProfile).company_name).toBe('Acme Hauling LLC')
  })
})

describe('canSelfEditRoles', () => {
  it('allows role edits for primary owners and first-visit bootstrap', () => {
    expect(canSelfEditRoles({ is_primary_owner: true })).toBe(true)
    expect(canSelfEditRoles({ is_primary_owner: false })).toBe(false)
    expect(canSelfEditRoles(null)).toBe(true)
    expect(canSelfEditRoles(undefined)).toBe(true)
  })
})

describe('isAnySaveInFlight', () => {
  it('returns true when either save action is running', () => {
    expect(isAnySaveInFlight(false, false)).toBe(false)
    expect(isAnySaveInFlight(true, false)).toBe(true)
    expect(isAnySaveInFlight(false, true)).toBe(true)
    expect(isAnySaveInFlight(true, true)).toBe(true)
  })
})

describe('resolvePersistedRosterId', () => {
  it('prefers API-returned roster id when adding a new team member', () => {
    expect(resolvePersistedRosterId(null, 'roster-new')).toBe('roster-new')
    expect(resolvePersistedRosterId('roster-existing', 'roster-new')).toBe('roster-new')
    expect(resolvePersistedRosterId('roster-existing', null)).toBe('roster-existing')
  })
})

describe('shouldShowBootstrapProfilePrompt', () => {
  it('prompts to finish profile after carrier bootstrap without driver details', () => {
    expect(
      shouldShowBootstrapProfilePrompt({
        is_primary_owner: true,
        company_name: 'Acme Hauling',
        driver_full_name: '',
      })
    ).toBe(true)
    expect(
      shouldShowBootstrapProfilePrompt({
        is_primary_owner: true,
        company_name: 'Acme Hauling',
        driver_full_name: 'Alex Owner',
      })
    ).toBe(false)
  })
})

describe('applySelfSaveScope', () => {
  const ownProfile = {
    user_id: 'owner-1',
    company_name: 'Acme Hauling LLC',
    driver_full_name: 'Owner Name',
    is_primary_owner: true,
  }

  it('applies carrier-only and member-only scopes on the server', () => {
    const form = {
      ...memberProfileFromRow(ownProfile),
      company_name: 'Edited Carrier',
      driver_full_name: 'Edited Driver',
    }

    expect(applySelfSaveScope(form, ownProfile, 'carrier_only')).toMatchObject({
      company_name: 'Edited Carrier',
      driver_full_name: 'Owner Name',
    })
    expect(applySelfSaveScope(form, ownProfile, 'member_only')).toMatchObject({
      company_name: 'Acme Hauling LLC',
      driver_full_name: 'Edited Driver',
    })
    expect(applySelfSaveScope(form, ownProfile, 'full')).toEqual(form)
  })
})

describe('shouldShowCarrierForm', () => {
  it('shows editable form before first carrier save on self profile', () => {
    expect(shouldShowCarrierForm({ kind: 'self' }, emptyMemberProfileForm(), false)).toBe(true)
  })

  it('never shows editable carrier form when editing team members', () => {
    const carrier = { company_name: 'Acme Hauling' }

    expect(shouldShowCarrierForm({ kind: 'member_profile', id: 'm1', userId: 'u2' }, carrier, false)).toBe(false)
    expect(shouldShowCarrierForm({ kind: 'member_profile', id: 'm1', userId: 'u2' }, carrier, true)).toBe(false)
    expect(shouldShowCarrierForm({ kind: 'team_member_profile', id: null }, carrier, false)).toBe(false)
  })

  it('shows form when primary owner expands carrier editing on self profile', () => {
    const carrier = { company_name: 'Acme Hauling' }

    expect(shouldShowCarrierForm({ kind: 'self' }, carrier, false)).toBe(false)
    expect(shouldShowCarrierForm({ kind: 'self' }, carrier, true)).toBe(true)
  })
})

describe('shouldShowTeamSectionCarrierDetails', () => {
  it('shows read-only expanded carrier details only when expanded with data', () => {
    const carrier = { company_name: 'Acme Hauling' }

    expect(shouldShowTeamSectionCarrierDetails(carrier, true)).toBe(true)
    expect(shouldShowTeamSectionCarrierDetails(carrier, false)).toBe(false)
    expect(shouldShowTeamSectionCarrierDetails(emptyMemberProfileForm(), true)).toBe(false)
  })
})

describe('shouldUseTeamMemberCarrierSummary', () => {
  it('uses one-line carrier summary when team member has saved carrier data and is collapsed', () => {
    const carrier = { company_name: 'Acme Hauling' }

    expect(
      shouldUseTeamMemberCarrierSummary({ kind: 'member_profile' }, carrier, false)
    ).toBe(true)
    expect(
      shouldUseTeamMemberCarrierSummary({ kind: 'member_profile' }, carrier, true)
    ).toBe(false)
    expect(shouldUseTeamMemberCarrierSummary({ kind: 'self' }, carrier, false)).toBe(false)
    expect(
      shouldUseTeamMemberCarrierSummary({ kind: 'team_member_profile', id: null }, emptyMemberProfileForm(), false)
    ).toBe(false)
    expect(
      shouldUseTeamMemberCarrierSummary({ kind: 'team_member_profile', id: 'tm-1' }, carrier, false)
    ).toBe(true)
    expect(
      shouldUseTeamMemberCarrierSummary({ kind: 'team_member_profile', id: 'tm-1' }, carrier, true)
    ).toBe(false)
  })
})

describe('memberProfileToUpsertPayloadWithoutCarrier', () => {
  it('omits edited carrier fields from member profile upsert payload', () => {
    const orgProfile = {
      user_id: 'owner-1',
      company_name: 'Acme Hauling LLC',
      usdot_number: '1234567',
    }
    const payload = memberProfileToUpsertPayloadWithoutCarrier(
      {
        ...emptyMemberProfileForm(),
        company_name: 'Wrong Carrier',
        driver_full_name: 'Riley Driver',
      },
      'member-1',
      orgProfile
    )

    expect(payload).toMatchObject({
      user_id: 'member-1',
      company_name: 'Acme Hauling LLC',
      usdot_number: '1234567',
      driver_full_name: 'Riley Driver',
    })
  })
})

describe('teamMemberProfileFromRow', () => {
  it('delegates to memberProfileFromRow for roster rows', () => {
    const row = {
      id: 'tm-1',
      organization_id: 'org-1',
      created_by_user_id: 'owner-1',
      driver_full_name: 'Riley Roster',
      cdl_state: 'TX',
      user_roles: ['Driver'],
    }

    expect(teamMemberProfileFromRow(row)).toEqual(memberProfileFromRow(row))
    expect(teamMemberProfileFromRow(null)).toEqual(memberProfileFromRow(null))
  })
})

describe('generateOrganizationId', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'test-org-uuid' })

    expect(generateOrganizationId()).toBe('test-org-uuid')
  })

  it('throws when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {})

    expect(() => generateOrganizationId()).toThrow('crypto.randomUUID is not available')
  })
})

describe('profile landing and member edit card helpers', () => {
  it('shows landing view only on self with no active member edit', () => {
    expect(shouldShowLandingProfileView({ kind: 'self' }, null, false)).toBe(true)
    expect(shouldShowLandingProfileView({ kind: 'self' }, 'member_profile-owner', false)).toBe(false)
    expect(shouldShowLandingProfileView({ kind: 'self' }, null, true)).toBe(false)
    expect(shouldShowLandingProfileView({ kind: 'team_member_profile', id: null }, null, false)).toBe(false)
  })

  it('shows edit-my-profile on landing only for driver self-service actors', () => {
    const driverProfile = {
      user_id: 'driver-1',
      is_primary_owner: false,
      user_roles: ['Driver'],
    }

    expect(
      shouldShowEditMyProfileOnLanding({ kind: 'self' }, null, false, driverProfile, true)
    ).toBe(true)
    expect(
      shouldShowEditMyProfileOnLanding({ kind: 'self' }, 'member_profile-driver', false, driverProfile, true)
    ).toBe(false)
    expect(
      shouldShowEditMyProfileOnLanding({ kind: 'self' }, null, false, driverProfile, false)
    ).toBe(false)
  })

  it('hides member edit card during bootstrap and shows unified setup instead', () => {
    expect(shouldShowMemberEditCard({ kind: 'self' }, null, true)).toBe(false)
    expect(shouldShowOwnerBootstrapSetupCard({ kind: 'self' }, true)).toBe(true)
    expect(shouldShowMemberEditCard({ kind: 'self' }, null, false)).toBe(false)
    expect(shouldShowMemberEditCard({ kind: 'team_member_profile', id: null }, null, false)).toBe(true)
    expect(shouldShowMemberEditCard({ kind: 'self' }, 'member_profile-driver', false)).toBe(true)
  })

  it('shows member edit card after bootstrap carrier save when driver details are pending', () => {
    const profileAfterCarrierSave = {
      is_primary_owner: true,
      company_name: 'Acme Hauling LLC',
      driver_full_name: '',
    }

    expect(
      shouldShowMemberEditCard({ kind: 'self' }, null, false, profileAfterCarrierSave)
    ).toBe(true)
  })

  it('labels member cards and save buttons for add/edit flows', () => {
    expect(memberEditCardTitle({ kind: 'team_member_profile', id: null }, null)).toBe('New Team Member')
    expect(memberEditCardTitle({ kind: 'member_profile', id: 'x', userId: 'y' }, 'Riley')).toBe(
      'Edit Riley'
    )
    expect(memberEditSaveButtonLabel(false, { kind: 'team_member_profile', id: null })).toBe(
      'Save New Member'
    )
    expect(memberEditSaveButtonLabel(false, { kind: 'self' })).toBe('Save Profile')
  })

  it('places new team member save under roles and requires at least one role', () => {
    const newTarget = { kind: 'team_member_profile' as const, id: null }
    expect(shouldShowMemberSaveInCardHeader(newTarget)).toBe(false)
    expect(shouldShowMemberSaveInCardHeader({ kind: 'member_profile', id: 'x', userId: 'y' })).toBe(
      true
    )
    expect(
      memberEditSaveDisabled(newTarget, {
        isSaving: false,
        canWriteProfile: true,
        forcedCarrierOwner: false,
        isLoadingMember: false,
        userRoles: [],
      })
    ).toBe(true)
    expect(
      memberEditSaveDisabled(newTarget, {
        isSaving: false,
        canWriteProfile: true,
        forcedCarrierOwner: false,
        isLoadingMember: false,
        userRoles: ['Driver'],
      })
    ).toBe(false)
  })
})

describe('isValidMemberProfileUserRolesCombination', () => {
  it('allows Owner Operator and single-role combinations', () => {
    expect(isValidMemberProfileUserRolesCombination(['Owner', 'Driver'])).toBe(true)
    expect(isValidMemberProfileUserRolesCombination(['Owner'])).toBe(true)
    expect(isValidMemberProfileUserRolesCombination(['Admin', 'Driver'])).toBe(true)
    expect(isValidMemberProfileUserRolesCombination(['Driver'])).toBe(true)
    expect(isValidMemberProfileUserRolesCombination([])).toBe(true)
  })

  it('rejects Owner paired with non-Driver roles', () => {
    expect(isValidMemberProfileUserRolesCombination(['Owner', 'Admin'])).toBe(false)
    expect(isValidMemberProfileUserRolesCombination(['Owner', 'Permit Clerk'])).toBe(false)
  })

  it('allows legacy Owner / Admin with optional Driver only', () => {
    expect(isValidMemberProfileUserRolesCombination(['Owner / Admin'])).toBe(true)
    expect(isValidMemberProfileUserRolesCombination(['Owner / Admin', 'Driver'])).toBe(true)
    expect(isValidMemberProfileUserRolesCombination(['Owner / Admin', 'Viewer'])).toBe(false)
  })
})

describe('owner bootstrap setup helpers', () => {
  it('detects Owner Operator when Owner and Driver roles are selected', () => {
    expect(isOwnerOperatorSelected(['Owner', 'Driver'])).toBe(true)
    expect(isOwnerOperatorSelected(['Owner'])).toBe(false)
    expect(isOwnerOperatorSelected(['Driver'])).toBe(false)
  })

  it('toggles Driver role while preserving bootstrap Owner', () => {
    expect(applyOwnerOperatorRoles(emptyMemberProfileForm(), true).user_roles).toEqual([
      'Owner',
      'Driver',
    ])
    expect(applyOwnerOperatorRoles(emptyMemberProfileForm(), false).user_roles).toEqual(['Owner'])
    expect(
      applyOwnerOperatorRoles(
        { ...emptyMemberProfileForm(), user_roles: ['Owner', 'Driver'] },
        false
      ).user_roles
    ).toEqual(['Owner'])
  })

  it('clamps bootstrap roles server-side to Owner or Owner+Driver', () => {
    expect(
      normalizeBootstrapSelfRoles(
        { ...emptyMemberProfileForm(), user_roles: ['Admin', 'Driver'] },
        null
      ).user_roles
    ).toEqual(['Owner', 'Driver'])
    expect(
      normalizeBootstrapSelfRoles(
        { ...emptyMemberProfileForm(), user_roles: ['Admin'] },
        null
      ).user_roles
    ).toEqual(['Owner'])
    expect(
      normalizeBootstrapSelfRoles(
        { ...emptyMemberProfileForm(), user_roles: ['Owner'] },
        { user_id: 'u1', organization_id: 'org-1' }
      ).user_roles
    ).toEqual(['Owner'])
  })

  it('mirrors personal email to carrier email on bootstrap save prep', () => {
    expect(
      prepareBootstrapFormForSave({
        ...emptyMemberProfileForm(),
        driver_email: 'owner@acme.com',
        carrier_email: '',
        user_roles: ['Owner'],
      })
    ).toMatchObject({
      driver_email: 'owner@acme.com',
      carrier_email: 'owner@acme.com',
      user_roles: ['Owner'],
    })
    expect(
      prepareBootstrapFormForSave({
        ...emptyMemberProfileForm(),
        driver_email: 'owner@acme.com',
        carrier_email: 'dispatch@acme.com',
      }).carrier_email
    ).toBe('dispatch@acme.com')
    expect(
      prepareBootstrapFormForSave({
        ...emptyMemberProfileForm(),
        driver_email: 'owner@acme.com',
        user_roles: ['Owner', 'Driver'],
      }).user_roles
    ).toEqual(['Owner', 'Driver'])
  })

  it('exposes welcome copy and save label for bootstrap card', () => {
    expect(getOwnerBootstrapSetupCardTitle()).toBe('Welcome to Truckeros')
    expect(getOwnerBootstrapSetupCardSubtitle()).toContain('account Owner')
    expect(getOwnerBootstrapOwnerOperatorHint()).toContain('Team Roster')
    expect(getOwnerBootstrapSaveButtonLabel(false)).toBe('Complete Setup')
    expect(getOwnerBootstrapSaveButtonLabel(true)).toBe('Setting up...')
  })

  it('validates bootstrap required fields and trims email', () => {
    expect(validateBootstrapSelfSave(emptyMemberProfileForm()).ok).toBe(false)
    expect(
      validateBootstrapSelfSave({
        ...emptyMemberProfileForm(),
        company_name: 'Acme',
        driver_full_name: 'Jane',
        driver_email: '  owner@acme.com  ',
        user_roles: ['Owner', 'Driver'],
      })
    ).toMatchObject({
      ok: true,
      form: {
        company_name: 'Acme',
        driver_full_name: 'Jane',
        driver_email: 'owner@acme.com',
        carrier_email: 'owner@acme.com',
        user_roles: ['Owner', 'Driver'],
      },
    })
    expect(validateBootstrapEmail('not-an-email').ok).toBe(false)
    expect(validateBootstrapSelfSave(emptyMemberProfileForm())).toMatchObject({
      ok: false,
      message: 'Company name is required.',
    })
  })

  it('validates carrier_only bootstrap with company required and optional PII limits', () => {
    expect(validateBootstrapCarrierOnlySave(emptyMemberProfileForm())).toMatchObject({
      ok: false,
      message: 'Company name is required.',
    })
    expect(
      validateBootstrapCarrierOnlySave({
        ...emptyMemberProfileForm(),
        company_name: 'Acme Hauling',
        user_roles: ['Admin'],
      })
    ).toMatchObject({
      ok: true,
      form: { company_name: 'Acme Hauling', user_roles: ['Owner'] },
    })
    const carrierBootstrap = validateBootstrapCarrierOnlySave({
      ...emptyMemberProfileForm(),
      company_name: 'Acme',
      user_roles: ['Admin', 'Driver'],
    })
    expect(carrierBootstrap.ok).toBe(true)
    if (carrierBootstrap.ok) {
      expect(normalizeBootstrapSelfRoles(carrierBootstrap.form, null).user_roles).toEqual([
        'Owner',
        'Driver',
      ])
    }
    expect(
      validateBootstrapOptionalPhone('1'.repeat(BOOTSTRAP_MAX_PHONE_LENGTH + 1), 'Company phone').ok
    ).toBe(false)
    expect(
      validateBootstrapOptionalEmail('a@b.c', 'Email')
    ).toMatchObject({ ok: true, value: 'a@b.c' })
    expect(
      validateBootstrapOptionalEmail('x'.repeat(BOOTSTRAP_MAX_EMAIL_LENGTH + 1) + '@a.com', 'Email').ok
    ).toBe(false)
  })

  it('shows unified bootstrap card only for self on first visit', () => {
    expect(shouldShowOwnerBootstrapSetupCard({ kind: 'self' }, true)).toBe(true)
    expect(shouldShowOwnerBootstrapSetupCard({ kind: 'self' }, false)).toBe(false)
    expect(
      shouldShowOwnerBootstrapSetupCard({ kind: 'team_member_profile', id: null }, true)
    ).toBe(false)
  })
})

describe('teamMemberProfileToPayload', () => {
  it('builds roster insert payload with org and creator metadata', () => {
    const payload = teamMemberProfileToPayload(
      {
        ...emptyMemberProfileForm(),
        driver_full_name: 'Riley Roster',
        user_roles: ['Driver'],
      },
      'org-1',
      'owner-user'
    )

    expect(payload).toMatchObject({
      organization_id: 'org-1',
      created_by_user_id: 'owner-user',
      linked_user_id: null,
      driver_full_name: 'Riley Roster',
      user_roles: ['Driver'],
    })
  })
})