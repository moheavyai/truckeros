'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import { US_STATE_OPTIONS } from '@/lib/us-states'
import {
  buildTeamMemberList,
  canDeleteMember,
  canEditMember,
  canManageMemberPermissions,
  canRequestMemberRemoval,
  canWriteTeamData,
  isPrimaryOwner,
  memberDisplayName,
  parseTeamMemberPermissions,
  roleBadgeClass,
  shouldShowTeamSection,
} from '@/lib/member-profile-permissions'
import { isForcedCarrierOwner } from '@/lib/forced-carrier-owner'
import { resolveActingRolesFromInputs } from '@/lib/nav-actor'
import {
  canSeeSetupGuidance,
  getBootstrapWelcomeSubtitle,
  getBootstrapWelcomeTitle,
  getGuidedOnboardingCopy,
  getWelcomeHeadline,
  getWelcomeSubtitle,
  ONBOARDING_PATH,
  readOnboardingGuidedDismissed,
  readRoleWelcomeSeen,
  resolveOnboardingPersona,
  resolveOnboardingStep,
  shouldShowFullWelcomeBanner,
  shouldShowTeamRoleWelcome,
  writeOnboardingGuidedDismissed,
  writeRoleWelcomeSeen,
} from '@/lib/onboarding'
import { useOrganizationContext } from '@/lib/organization-context'
import {
  buildCarrierOnlyApiSavePayload,
  canSaveCarrierInfo,
  CARRIER_SAVE_FORBIDDEN_MESSAGE,
  applyOwnerOperatorRoles,
  ensureBootstrapOwnerRoles,
  getOwnerBootstrapSaveButtonLabel,
  isOwnerOperatorSelected,
  ownerAdminBadgeRole,
  getLandingAssignedRoles,
  getMemberEditCardSubtitle,
  getTeamMemberRolesHelperText,
  getTeamSectionCarrierHelperText,
  getOwnerBootstrapOwnerOperatorHint,
  validateBootstrapSelfSave,
  logCarrierSaveDebug,
  logCarrierSaveWarn,
  validateBootstrapCarrierSaveRoles,
  buildMemberProfileSavePayloadWithoutCarrier,
  buildSelfMemberSavePayload,
  canSelfEditRoles,
  isAnySaveInFlight,
  isNewTeamMemberTarget,
  memberEditCardTitle,
  memberEditSaveButtonLabel,
  memberEditSaveDisabled,
  shouldShowMemberSaveInCardHeader,
  resolvePersistedRosterId,
  shouldShowBootstrapProfilePrompt,
  shouldShowOwnerBootstrapSetupCard,
  needsPrimaryOwnerBootstrap,
  resolveActorProfile,
  emptyMemberProfileForm,
  formatCarrierNameSummary,
  formatCarrierSummaryDisplay,
  hasCarrierData,
  memberProfileFromRow,
  carrierFieldsDiffer,
  resetCarrierFieldsInForm,
  resolveCarrierDataSource,
  shouldShowCarrierForm,
  shouldShowCarrierInformationCard,
  shouldShowEditMyProfileOnLanding,
  shouldShowLandingProfileView,
  shouldShowMemberEditCard,
  shouldShowAssignedRoleBadges,
  shouldShowOwnerAdminBadge,
  shouldShowTeamSectionCarrierBlock,
  shouldShowUserRolesSection,
  shouldShowTeamSectionCarrierDetails,
  shouldUseCarrierSummaryMode,
  shouldUseTeamMemberCarrierSummary,
  teamMemberProfileFromRow,
  type ProfileEditingTarget,
} from '@/lib/member-profile'
import {
  applyDriverRestrictedFieldBaseline,
  canEditProfileField,
  detectRestrictedFieldChanges,
  hasPendingRestrictedFieldEdits,
  isDriverRestrictedField,
  isDriverSelfServiceActor,
  type ProfileFieldKey,
} from '@/lib/profile-field-permissions'
import {
  buildRestrictedChangeRequestPayload,
  pendingProfileChangeFieldKeys,
  profileChangeFieldLabel,
  type ProfileChangeRequestRow,
} from '@/lib/profile-change-requests'
import {
  mergeCarrierFieldsOntoProfile,
  profileFromSaveResponse,
  resolveRefreshedOwnProfile,
  teamMemberProfileFromSaveResponse,
} from '@/lib/profile-persistence'
import {
  ASSIGNABLE_TEAM_ROLES,
  USER_ROLE_OPTIONS,
  type MemberProfile,
  type MemberProfileFormData,
  type TeamMemberListItem,
  type TeamMemberProfile,
} from '@/types/member-profile'
import type { CarrierLinkRequest } from '@/types/organization'
import { deletionResourceLabel, type DeletionRequestRow } from '@/lib/deletion-requests'
import { isDevAccountSwitcherEnabled } from '@/lib/dev-mode'
import {
  canReinviteMember,
  createTeamInviteViaApi,
  formatInviteDeliverySummary,
  resolveInviteRoleFromMemberRoles,
  resolveMemberInviteContact,
} from '@/lib/team-invite-helpers'
import { INVITE_ALLOWED_ROLES, normalizeInviteEmail, type TeamInviteRow } from '@/lib/team-invites'
import {
  CUSTOM_PERMISSION_AREAS,
  emptyMemberPermissionConfig,
  type MemberPermissionConfig,
} from '@/lib/team-permissions'
import { hasManagementAccess } from '@/lib/team-permissions'
import {
  fetchActorTeamContext,
  fetchOrganizationMembershipForOrg,
  type OrganizationMembershipLink,
} from '@/lib/roster-profile-link'


/** Mobile-first contrast: stronger borders/text on small screens; softer from sm: up (matches permit-test / portal-assist). */
const fieldControlClass =
  'border border-gray-500 sm:border-gray-300 text-gray-900 placeholder:text-gray-500 bg-white'
const inputClass =
  `${fieldControlClass} px-3 py-2 rounded-lg w-full text-sm focus:outline-none focus:ring-2 focus:ring-black/10`
const buttonSecondaryClass =
  'inline-flex items-center justify-center min-h-[44px] rounded-lg border border-gray-500 sm:border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 transition disabled:opacity-50 touch-manipulation'
const buttonPrimaryClass =
  'bg-black hover:bg-gray-900 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.985]'
const buttonPrimaryCompactClass =
  'rounded-lg bg-black hover:bg-gray-900 disabled:opacity-50 text-white px-4 py-2 text-sm font-semibold transition whitespace-nowrap'
const buttonSuccessClass =
  'bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-semibold transition'
const buttonSuccessOutlineClass =
  'text-sm px-3 py-1.5 border border-emerald-500 sm:border-emerald-300 hover:bg-emerald-50 rounded-lg text-emerald-900 sm:text-emerald-800 transition disabled:opacity-50'
const fieldLabelClass = 'block text-xs font-medium text-gray-600 sm:text-gray-500 mb-1'
/** Hints softer than labels so instructional chrome does not dominate */
const fieldHintClass = 'text-sm text-gray-500'
/** Body/meta data slightly stronger than pure field hints */
const mutedTextClass = 'text-gray-600 sm:text-gray-500'
const bodyTextClass = 'text-gray-700 sm:text-gray-600'
const dividerBorderClass = 'border-gray-300 sm:border-gray-200'
const softDividerBorderClass = 'border-gray-200 sm:border-gray-100'
const listDivideClass = 'divide-y divide-gray-200 sm:divide-gray-100'
const sectionHeaderClass = `px-6 py-5 border-b ${dividerBorderClass} bg-gray-50`
const checkboxClass = 'h-4 w-4 rounded accent-emerald-700 border-gray-500 sm:border-gray-300'
const radioClass = 'h-4 w-4 accent-emerald-700 border-gray-500 sm:border-gray-300'
const cardClass = 'bg-white border border-gray-300 sm:border-gray-200 rounded-2xl p-6'
const cardSectionClass =
  'bg-white border border-gray-300 sm:border-gray-200 rounded-2xl shadow-sm overflow-hidden'
const nestedPanelClass = 'rounded-xl border border-gray-300 sm:border-gray-200 bg-gray-50 px-4 py-3'

type FieldConfig = {
  key: keyof MemberProfileFormData
  label: string
  type?: string
  placeholder?: string
}

const CARRIER_FIELDS: FieldConfig[] = [
  { key: 'company_name', label: 'Company Name', placeholder: 'ABC Trucking LLC' },
  { key: 'usdot_number', label: 'USDOT#', placeholder: '1234567' },
  { key: 'mc_number', label: 'MC#', placeholder: 'MC-123456' },
  { key: 'ein', label: 'EIN', placeholder: '12-3456789' },
  { key: 'carrier_address', label: 'Address', placeholder: '123 Main St, City, ST 12345' },
  { key: 'carrier_phone', label: 'Phone', type: 'tel', placeholder: '(555) 123-4567' },
  { key: 'carrier_email', label: 'Email', type: 'email', placeholder: 'dispatch@company.com' },
  { key: 'insurance_contact', label: 'Insurance Contact', placeholder: 'Agent name / phone / email' },
]

const BOOTSTRAP_CONTACT_FIELDS: FieldConfig[] = [
  { key: 'driver_full_name', label: 'Full Name', placeholder: 'Jane Doe' },
  { key: 'driver_email', label: 'Email', type: 'email', placeholder: 'you@company.com' },
  { key: 'carrier_phone', label: 'Company Phone', type: 'tel', placeholder: '(555) 123-4567' },
  { key: 'driver_phone', label: 'Cell Phone', type: 'tel', placeholder: '(555) 987-6543' },
]

const BOOTSTRAP_CARRIER_FIELDS: FieldConfig[] = CARRIER_FIELDS.filter(
  (field) => field.key !== 'carrier_phone' && field.key !== 'carrier_email'
)

const DRIVER_IDENTITY_FIELDS: FieldConfig[] = [
  { key: 'driver_full_name', label: 'Full Name', placeholder: 'Jane Doe' },
  { key: 'cdl_number', label: 'CDL#', placeholder: 'D1234567' },
]

const DRIVER_CONTACT_FIELDS: FieldConfig[] = [
  { key: 'driver_phone', label: 'Phone', type: 'tel', placeholder: '(555) 987-6543' },
  { key: 'driver_email', label: 'Email', type: 'email', placeholder: 'driver@email.com' },
  { key: 'emergency_contact', label: 'Emergency Contact', placeholder: 'Name, relationship, phone' },
]

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

type UserRolesCheckboxGridProps = {
  userRoles: string[]
  roleOptions?: readonly string[]
  canEditRoles: boolean
  canWriteProfile: boolean
  disabled: boolean
  helperText: string
  onToggleRole: (role: string) => void
}

type MemberPermissionsEditorProps = {
  permissions: MemberPermissionConfig
  canEdit: boolean
  disabled: boolean
  onChange: (next: MemberPermissionConfig) => void
}

function memberPermissionAreaLabel(area: (typeof CUSTOM_PERMISSION_AREAS)[number]): string {
  switch (area) {
    case 'equipment':
      return 'Equipment'
    case 'profiles':
      return 'Profiles'
    case 'account_settings':
      return 'Account settings'
    default:
      return area
  }
}

function MemberPermissionsEditor({
  permissions,
  canEdit,
  disabled,
  onChange,
}: MemberPermissionsEditorProps) {
  return (
    <div className={`mt-6 pt-6 border-t ${softDividerBorderClass}`}>
      <h3 className="text-sm font-semibold text-gray-900">Permissions</h3>
      <p className={`${fieldHintClass} mt-1 mb-4`}>
        Global inherits role defaults. Custom lets you toggle Equipment, Profiles, and Account settings.
      </p>
      <div className="flex flex-wrap gap-4 mb-4">
        {(['global', 'custom'] as const).map((mode) => (
          <label key={mode} className="flex items-center gap-2 text-sm text-gray-900">
            <input
              type="radio"
              name="permission-mode"
              checked={permissions.mode === mode}
              onChange={() =>
                onChange(
                  mode === 'global'
                    ? { mode: 'global' }
                    : {
                        mode: 'custom',
                        custom: {
                          equipment: false,
                          profiles: false,
                          account_settings: false,
                        },
                      }
                )
              }
              disabled={!canEdit || disabled}
              className={radioClass}
            />
            {mode === 'global' ? 'Global' : 'Custom'}
          </label>
        ))}
      </div>
      {permissions.mode === 'custom' && (
        <div className="grid sm:grid-cols-3 gap-3">
          {CUSTOM_PERMISSION_AREAS.map((area) => (
            <label
              key={area}
              className="flex items-center gap-2.5 text-sm text-gray-900 rounded-lg border border-gray-300 sm:border-gray-200 px-3 py-2.5"
            >
              <input
                type="checkbox"
                checked={permissions.custom?.[area] === true}
                onChange={() =>
                  onChange({
                    ...permissions,
                    custom: {
                      equipment: permissions.custom?.equipment === true,
                      profiles: permissions.custom?.profiles === true,
                      account_settings: permissions.custom?.account_settings === true,
                      [area]: !(permissions.custom?.[area] === true),
                    },
                  })
                }
                disabled={!canEdit || disabled}
                className={checkboxClass}
              />
              {memberPermissionAreaLabel(area)}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function UserRolesCheckboxGrid({
  userRoles,
  roleOptions = USER_ROLE_OPTIONS,
  canEditRoles,
  canWriteProfile,
  disabled,
  helperText,
  onToggleRole,
}: UserRolesCheckboxGridProps) {
  return (
    <>
      <p className={`${fieldHintClass} mb-4`}>{helperText}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {roleOptions.map((role) => (
          <label
            key={role}
            className={`flex items-center gap-2.5 text-sm text-gray-900 rounded-lg border border-gray-300 sm:border-gray-200 px-3 py-2.5 ${
              canEditRoles && canWriteProfile ? 'cursor-pointer hover:bg-gray-50' : 'opacity-70'
            }`}
          >
            <input
              type="checkbox"
              checked={userRoles.includes(role)}
              onChange={() => onToggleRole(role)}
              disabled={!canEditRoles || !canWriteProfile || disabled}
              className={checkboxClass}
            />
            {role}
          </label>
        ))}
      </div>
    </>
  )
}

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingCarrier, setSavingCarrier] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [guidedStepsDismissed, setGuidedStepsDismissed] = useState(false)
  const [roleWelcomeSeen, setRoleWelcomeSeen] = useState(false)
  const [contextLoadFailed, setContextLoadFailed] = useState(false)
  const [orgMemberProfileCount, setOrgMemberProfileCount] = useState(1)
  const [hasOrgEquipment, setHasOrgEquipment] = useState(false)
  const [form, setForm] = useState<MemberProfileFormData>(emptyMemberProfileForm())
  const [ownProfile, setOwnProfile] = useState<MemberProfile | null>(null)
  const [linkedRosterProfile, setLinkedRosterProfile] = useState<TeamMemberProfile | null>(null)
  const [organizationMembership, setOrganizationMembership] =
    useState<OrganizationMembershipLink | null>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMemberListItem[]>([])
  const [orgMemberRows, setOrgMemberRows] = useState<MemberProfile[]>([])
  const [teamRosterRows, setTeamRosterRows] = useState<TeamMemberProfile[]>([])
  const [memberPermissions, setMemberPermissions] = useState<MemberPermissionConfig>(
    emptyMemberPermissionConfig()
  )
  const [editingTarget, setEditingTarget] = useState<ProfileEditingTarget>({ kind: 'self' })
  const [editingDisplayName, setEditingDisplayName] = useState<string | null>(null)
  const [editingMemberKey, setEditingMemberKey] = useState<string | null>(null)
  const [loadingMemberKey, setLoadingMemberKey] = useState<string | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<TeamMemberListItem | null>(null)
  const [deleteCandidateIsRequest, setDeleteCandidateIsRequest] = useState(false)
  const [pendingDeletionRequests, setPendingDeletionRequests] = useState<DeletionRequestRow[]>([])
  const [reviewingDeletionRequestId, setReviewingDeletionRequestId] = useState<string | null>(null)
  const [teamInvites, setTeamInvites] = useState<TeamInviteRow[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('Driver')
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null)
  const [acceptingInviteId, setAcceptingInviteId] = useState<string | null>(null)
  const [reinvitingMemberKey, setReinvitingMemberKey] = useState<string | null>(null)
  const [savingAndInviting, setSavingAndInviting] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error' | 'warning'
    text: string
  } | null>(null)
  const [carrierMessage, setCarrierMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [carrierFormExpanded, setCarrierFormExpanded] = useState(false)
  const [incomingLinkRequests, setIncomingLinkRequests] = useState<CarrierLinkRequest[]>([])
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null)
  const [ownPendingChangeRequests, setOwnPendingChangeRequests] = useState<ProfileChangeRequestRow[]>([])
  const [adminPendingChangeRequests, setAdminPendingChangeRequests] = useState<ProfileChangeRequestRow[]>([])
  const [reviewingChangeRequestId, setReviewingChangeRequestId] = useState<string | null>(null)
  const [withdrawingChangeRequestId, setWithdrawingChangeRequestId] = useState<string | null>(null)
  const teamSectionRef = useRef<HTMLElement | null>(null)
  const editRequestIdRef = useRef(0)
  const formBaselineRef = useRef<string>(JSON.stringify(emptyMemberProfileForm()))
  const formRef = useRef(form)
  formRef.current = form
  const router = useRouter()
  const maxDateOfBirth = todayIsoDate()

  const effectiveOwnProfile = useMemo(
    () =>
      user
        ? resolveActorProfile(ownProfile, linkedRosterProfile, user.id, organizationMembership)
        : ownProfile,
    [user, ownProfile, linkedRosterProfile, organizationMembership]
  )

  /**
   * Acting roles for home-org gates/badges (Phase 2 §4.1 SSoT).
   * Uses membership for home when available; never invents foreign-org context here.
   */
  const homeActingActor = useMemo(() => {
    const homeOrgId =
      ownProfile?.organization_id ??
      effectiveOwnProfile?.organization_id ??
      organizationMembership?.organization_id ??
      null
    const membershipForHome =
      organizationMembership &&
      homeOrgId &&
      organizationMembership.organization_id === homeOrgId
        ? organizationMembership
        : null
    return resolveActingRolesFromInputs({
      membershipRole: membershipForHome?.role ?? null,
      membershipIsPrimaryOwner: membershipForHome?.is_primary_owner ?? null,
      homeOrgId,
      homeIsPrimaryOwner:
        ownProfile?.is_primary_owner ?? effectiveOwnProfile?.is_primary_owner ?? null,
      homeUserRoles: ownProfile?.user_roles ?? effectiveOwnProfile?.user_roles,
      effectiveOrgId: homeOrgId,
    })
  }, [ownProfile, effectiveOwnProfile, organizationMembership])

  const actingPermissionActor = useMemo(
    () => ({
      user_id: effectiveOwnProfile?.user_id ?? user?.id,
      user_roles: homeActingActor.user_roles,
      is_primary_owner: homeActingActor.is_primary_owner,
    }),
    [effectiveOwnProfile?.user_id, user?.id, homeActingActor]
  )

  const { workspaceMode } = useOrganizationContext(
    effectiveOwnProfile?.organization_id ?? ownProfile?.organization_id ?? null
  )

  const isProfileBootstrap = useMemo(() => {
    // Do not force owner bootstrap when profile/membership load failed (issue 7).
    if (contextLoadFailed) return false
    return needsPrimaryOwnerBootstrap({
      actorEmail: user?.email,
      ownProfile,
      linkedRoster: linkedRosterProfile,
      organizationMembership,
    })
  }, [
    contextLoadFailed,
    user?.email,
    ownProfile,
    linkedRosterProfile,
    organizationMembership,
  ])

  const loadOwnPendingChangeRequests = useCallback(
    async (supabase: ReturnType<typeof createClient>, userId: string) => {
      const { data, error } = await supabase
        .from('profile_change_requests')
        .select('*')
        .eq('target_user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })

      if (error) {
        console.warn('profile_change_requests load', error)
        setOwnPendingChangeRequests([])
        return
      }

      setOwnPendingChangeRequests((data ?? []) as ProfileChangeRequestRow[])
    },
    []
  )

  const loadAdminPendingChangeRequests = useCallback(async (accessToken: string) => {
    const response = await fetch('/api/profile-change-requests', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const result = await response.json()
    if (response.ok && result.success) {
      setAdminPendingChangeRequests(result.data ?? [])
    } else {
      setAdminPendingChangeRequests([])
    }
  }, [])

  const loadIncomingLinkRequests = useCallback(async (accessToken: string) => {
    const response = await fetch('/api/carrier-link-requests?direction=incoming', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const result = await response.json()
    if (response.ok && result.success) {
      setIncomingLinkRequests(result.data ?? [])
    } else {
      setIncomingLinkRequests([])
    }
  }, [])

  const loadAdminDeletionRequests = useCallback(async (accessToken: string) => {
    const response = await fetch('/api/deletion-requests', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const result = await response.json()
    if (response.ok && result.success) {
      setPendingDeletionRequests(result.data ?? [])
    } else {
      setPendingDeletionRequests([])
    }
  }, [])

  const loadTeamInvites = useCallback(async (accessToken: string) => {
    const response = await fetch('/api/team-invites', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const result = await response.json()
    if (response.ok && result.success) {
      setTeamInvites(result.data ?? [])
    } else {
      setTeamInvites([])
    }
  }, [])

  const refreshTeamMembers = useCallback(
    (profile: MemberProfile | null, members: MemberProfile[], roster: TeamMemberProfile[], userId: string) => {
      setTeamMembers(buildTeamMemberList(profile, members, roster, userId))
    },
    []
  )

  const loadTeamData = useCallback(
    async (
      supabase: ReturnType<typeof createClient>,
      userId: string,
      profile: MemberProfile | null
    ): Promise<{ members: MemberProfile[]; roster: TeamMemberProfile[] }> => {
      let members: MemberProfile[] = profile ? [profile] : []
      let roster: TeamMemberProfile[] = []

      const orgId = profile?.organization_id ?? null
      const shouldLoadFullOrg =
        Boolean(orgId && profile && (isPrimaryOwner(profile) || hasManagementAccess(profile)))

      if (shouldLoadFullOrg && orgId) {
        const [{ data: orgMembers }, { data: rosterRows }, equipResult] = await Promise.all([
          supabase.from('member_profiles').select('*').eq('organization_id', orgId),
          supabase
            .from('team_member_profiles')
            .select('*')
            .eq('organization_id', orgId)
            .order('created_at', { ascending: true }),
          supabase
            .from('equipment_profiles')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId),
        ])

        if (orgMembers) members = orgMembers as MemberProfile[]
        if (rosterRows) roster = rosterRows as TeamMemberProfile[]
        // Shared team definition: member_profiles count for the org (matches Dashboard).
        setOrgMemberProfileCount(orgMembers?.length ?? members.length)
        setHasOrgEquipment((equipResult.count ?? 0) > 0)
      } else if (orgId) {
        // Still resolve team/equipment counts for guided onboarding (shared with Dashboard).
        const [{ count: memberCount }, { count: equipCount }] = await Promise.all([
          supabase
            .from('member_profiles')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId),
          supabase
            .from('equipment_profiles')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId),
        ])
        setOrgMemberProfileCount(memberCount ?? 1)
        setHasOrgEquipment((equipCount ?? 0) > 0)
      } else {
        setOrgMemberProfileCount(1)
        setHasOrgEquipment(false)
      }

      setOrgMemberRows(members)
      setTeamRosterRows(roster)
      refreshTeamMembers(profile, members, roster, userId)
      return { members, roster }
    },
    [refreshTeamMembers]
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('invite') === 'accepted') {
      setSaveMessage({ type: 'success', text: 'Invite accepted. Welcome to the team.' })
      window.history.replaceState({}, '', ONBOARDING_PATH)
    }
    if (params.get('carrier_connection') === 'accepted') {
      setSaveMessage({
        type: 'success',
        text: 'Carrier connection accepted. You are now the Carrier Owner.',
      })
      window.history.replaceState({}, '', ONBOARDING_PATH)
    }
  }, [])

  useEffect(() => {
    if (!user?.id) {
      setGuidedStepsDismissed(false)
      setRoleWelcomeSeen(false)
      return
    }
    setGuidedStepsDismissed(readOnboardingGuidedDismissed(user.id))
    setRoleWelcomeSeen(readRoleWelcomeSeen(user.id))
  }, [user?.id])

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)

        const { data, error } = await supabase
          .from('member_profiles')
          .select('*')
          .eq('user_id', session.user.id)
          .maybeSingle()

        let loadedProfile: MemberProfile | null = null

        let linkedRoster: TeamMemberProfile | null = null
        let membership: OrganizationMembershipLink | null = null

        if (error) {
          console.warn('member_profiles load', error)
          // Fail closed: do not treat load errors as first-time owner bootstrap.
          // Still attempt membership/roster; if that fails too, show error state.
          try {
            ;({ linkedRoster, organizationMembership: membership } = await fetchActorTeamContext(
              supabase,
              session.user.id,
              session.user.email
            ))
            setLinkedRosterProfile(linkedRoster)
            setOrganizationMembership(membership)
            if (!linkedRoster && !membership) {
              setContextLoadFailed(true)
              setSaveMessage({
                type: 'error',
                text: 'Could not load your profile. Refresh the page or try again later.',
              })
            } else {
              setContextLoadFailed(false)
              const actorProfile = resolveActorProfile(
                null,
                linkedRoster,
                session.user.id,
                membership
              )
              if (actorProfile) {
                setFormState(memberProfileFromRow(actorProfile))
                await loadTeamData(supabase, session.user.id, actorProfile)
              }
            }
          } catch (teamError) {
            console.warn('team context load after profile error', teamError)
            setContextLoadFailed(true)
            setSaveMessage({
              type: 'error',
              text: 'Could not load your profile. Refresh the page or try again later.',
            })
          }
        } else if (data) {
          setContextLoadFailed(false)
          loadedProfile = data as MemberProfile
          setOwnProfile(loadedProfile)
          setLinkedRosterProfile(null)
          // Home-org membership for acting SSoT (never null membership state when row exists).
          membership = await fetchOrganizationMembershipForOrg(
            supabase,
            session.user.id,
            loadedProfile.organization_id
          )
          setOrganizationMembership(membership)
          const loadedForm = memberProfileFromRow(loadedProfile)
          setFormState(loadedForm)
          await loadTeamData(supabase, session.user.id, loadedProfile)
          if (isDriverSelfServiceActor(loadedProfile)) {
            await loadOwnPendingChangeRequests(supabase, session.user.id)
          }
        } else {
          setContextLoadFailed(false)
          ;({ linkedRoster, organizationMembership: membership } = await fetchActorTeamContext(
            supabase,
            session.user.id,
            session.user.email
          ))

          setLinkedRosterProfile(linkedRoster)
          setOrganizationMembership(membership)

          const actorProfile = resolveActorProfile(
            null,
            linkedRoster,
            session.user.id,
            membership
          )
          const shouldBootstrap = needsPrimaryOwnerBootstrap({
            actorEmail: session.user.email,
            ownProfile: null,
            linkedRoster,
            organizationMembership: membership,
          })

          if (shouldBootstrap) {
            let initialForm = emptyMemberProfileForm()
            const sessionEmail = session.user.email?.trim()
            if (sessionEmail) {
              initialForm.driver_email = sessionEmail
            }
            initialForm = ensureBootstrapOwnerRoles(initialForm)
            setFormState(initialForm)
          } else if (actorProfile) {
            const loadedForm = memberProfileFromRow(actorProfile)
            setFormState(loadedForm)
            await loadTeamData(supabase, session.user.id, actorProfile)
            if (isDriverSelfServiceActor(actorProfile)) {
              await loadOwnPendingChangeRequests(supabase, session.user.id)
            }
          } else {
            let initialForm = emptyMemberProfileForm()
            const sessionEmail = session.user.email?.trim()
            if (sessionEmail) {
              initialForm.driver_email = sessionEmail
            }
            setFormState(initialForm)
          }
        }

        if (session.access_token) {
          const hydratedActorProfile =
            loadedProfile ??
            resolveActorProfile(null, linkedRoster, session.user.id, membership)

          await loadIncomingLinkRequests(session.access_token)
          if (hydratedActorProfile && isPrimaryOwner(hydratedActorProfile)) {
            await loadAdminPendingChangeRequests(session.access_token)
          }
          if (hydratedActorProfile && canManageMemberPermissions(hydratedActorProfile)) {
            await loadAdminDeletionRequests(session.access_token)
            await loadTeamInvites(session.access_token)
          }
        }
      }

      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [
    router,
    loadTeamData,
    loadIncomingLinkRequests,
    loadOwnPendingChangeRequests,
    loadAdminPendingChangeRequests,
    loadAdminDeletionRequests,
    loadTeamInvites,
  ])

  // First-visit implicit Owner is required for org bootstrap; team members skip this path.
  // Never force Owner roles when profile/membership load failed (contextLoadFailed).
  useEffect(() => {
    if (loading) return
    if (contextLoadFailed) return
    if (editingTarget.kind !== 'self') return
    const shouldBootstrap = needsPrimaryOwnerBootstrap({
      actorEmail: user?.email,
      ownProfile,
      linkedRoster: linkedRosterProfile,
      organizationMembership,
    })
    if (shouldBootstrap) {
      setFormState(ensureBootstrapOwnerRoles(formRef.current), true)
    }
  }, [
    loading,
    contextLoadFailed,
    ownProfile,
    linkedRosterProfile,
    organizationMembership,
    editingTarget.kind,
    user?.email,
  ])

  async function withdrawOwnProfileChangeRequest(requestId: string) {
    setWithdrawingChangeRequestId(requestId)
    setSaveMessage(null)

    try {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session?.user) throw new Error('Session expired. Please sign in again.')

      const { error } = await supabase
        .from('profile_change_requests')
        .delete()
        .eq('id', requestId)
        .eq('target_user_id', sessionData.session.user.id)
        .eq('status', 'pending')

      if (error) throw new Error(error.message)

      await loadOwnPendingChangeRequests(supabase, sessionData.session.user.id)
      setSaveMessage({ type: 'success', text: 'Pending profile change withdrawn.' })
    } catch (error) {
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to withdraw profile change request',
      })
    } finally {
      setWithdrawingChangeRequestId(null)
    }
  }

  async function respondToProfileChangeRequest(requestId: string, action: 'approve' | 'reject') {
    setReviewingChangeRequestId(requestId)
    setSaveMessage(null)

    try {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Session expired. Please sign in again.')

      const response = await fetch('/api/profile-change-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ id: requestId, action }),
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to review profile change request')
      }

      await loadAdminPendingChangeRequests(accessToken)
      if (effectiveOwnProfile?.organization_id) {
        await loadTeamData(supabase, user!.id, effectiveOwnProfile)
      }
      setSaveMessage({
        type: 'success',
        text:
          action === 'approve'
            ? 'Profile change approved and applied.'
            : 'Profile change request rejected.',
      })
    } catch (error) {
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to review profile change request',
      })
    } finally {
      setReviewingChangeRequestId(null)
    }
  }

  function handleEditMyProfile() {
    const selfMember = teamMembers.find((member) => member.is_self)
    if (!selfMember || !effectiveOwnProfile || !canWriteProfile) return
    if (!confirmDiscardIfDirty()) return
    void handleEditMember(selfMember)
  }

  async function respondToLinkRequest(requestId: string, action: 'approve' | 'reject') {
    setRespondingRequestId(requestId)
    setSaveMessage(null)

    try {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Session expired. Please sign in again.')

      const response = await fetch('/api/carrier-link-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ id: requestId, action }),
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to update link request')
      }

      await loadIncomingLinkRequests(accessToken)
      setSaveMessage({
        type: 'success',
        text: action === 'approve' ? 'Access approved. The user can now select your carrier.' : 'Link request rejected.',
      })
    } catch (error) {
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to update link request',
      })
    } finally {
      setRespondingRequestId(null)
    }
  }

  function syncFormBaseline(nextForm: MemberProfileFormData) {
    formBaselineRef.current = JSON.stringify(nextForm)
  }

  function getFormBaseline(): MemberProfileFormData {
    return JSON.parse(formBaselineRef.current) as MemberProfileFormData
  }

  function isEditingOwnProfileTarget(): boolean {
    if (editingTarget.kind === 'self') return true
    if (editingTarget.kind === 'member_profile' && editingTarget.userId === user?.id) return true
    return false
  }

  function isFormDirty(): boolean {
    return JSON.stringify(form) !== formBaselineRef.current
  }

  function confirmDiscardIfDirty(): boolean {
    if (!isFormDirty()) return true
    return window.confirm('Discard unsaved changes?')
  }

  function confirmDiscardCarrierIfDirty(): boolean {
    if (!carrierFieldsDiffer(form, effectiveOwnProfile)) return true
    return window.confirm('Discard unsaved carrier changes?')
  }

  function setFormState(nextForm: MemberProfileFormData, resetBaseline = true) {
    setForm(nextForm)
    if (resetBaseline) syncFormBaseline(nextForm)
  }

  function updateField(key: keyof MemberProfileFormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (saveMessage) setSaveMessage(null)
    if (carrierMessage) setCarrierMessage(null)
  }

  function isFieldDisabled(key: ProfileFieldKey): boolean {
    // Member/driver fields use global isSaving (not savingProfile alone) so edits stay
    // locked during carrier save and avoid conflicting form-state races.
    const forcedOwner = isForcedCarrierOwner(user?.email)
    if ((!canWriteProfile && !forcedOwner) || isLoadingMember || isSaving) return true
    if (editingTarget.kind === 'self' || isEditingOwnProfileTarget()) {
      return !canEditProfileField(effectiveOwnProfile, key)
    }
    return !primaryOwner
  }

  function toggleRole(role: string) {
    // Match canEditRoles: team members → managers may assign roles; self → primary only.
    const mayEditRoles =
      editingTarget.kind !== 'self'
        ? canManageMemberPermissions(actingPermissionActor)
        : canSelfEditRoles(effectiveOwnProfile)
    if (!mayEditRoles) return
    setForm((prev) => {
      const current = (prev.user_roles as string[]) || []
      const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role]
      return { ...prev, user_roles: next }
    })
    if (saveMessage) setSaveMessage(null)
  }

  function toggleOwnerOperator(checked: boolean) {
    setForm((prev) => applyOwnerOperatorRoles(prev, checked))
    if (saveMessage) setSaveMessage(null)
  }

  function memberListKey(member: TeamMemberListItem): string {
    return `${member.source}-${member.id}`
  }

  function resetToSelfForm() {
    setEditingTarget({ kind: 'self' })
    setEditingDisplayName(null)
    setEditingMemberKey(null)
    setLoadingMemberKey(null)
    setFormState(memberProfileFromRow(effectiveOwnProfile ?? ownProfile))
    setCarrierFormExpanded(false)
    setSaveMessage(null)
    setCarrierMessage(null)
  }

  function handleCollapseCarrier() {
    if (!confirmDiscardCarrierIfDirty()) return
    setFormState(resetCarrierFieldsInForm(form, effectiveOwnProfile ?? ownProfile), false)
    setCarrierFormExpanded(false)
    setCarrierMessage(null)
  }

  async function handleEditMember(member: TeamMemberListItem) {
    if (!effectiveOwnProfile || !canEditMember(actingPermissionActor, member)) return

    const requestId = ++editRequestIdRef.current
    const memberKey = memberListKey(member)
    const supabase = createClient()
    const displayName = member.display_name?.trim() || 'team member'

    setLoadingMemberKey(memberKey)
    setEditingDisplayName(displayName)
    setCarrierFormExpanded(false)
    setSaveMessage(null)
    setCarrierMessage(null)

    try {
      if (member.source === 'member_profile' && member.user_id) {
        let row = orgMemberRows.find((entry) => entry.user_id === member.user_id)

        if (!row) {
          const { data, error } = await supabase
            .from('member_profiles')
            .select('*')
            .eq('user_id', member.user_id)
            .maybeSingle()

          if (requestId !== editRequestIdRef.current) return

          if (error) {
            console.warn('member_profiles fetch for edit', error)
            throw new Error('Could not load member profile. Please try again.')
          }

          if (!data) {
            throw new Error('Member profile not found.')
          }

          row = data as MemberProfile
          setOrgMemberRows((prev) => {
            const exists = prev.some((entry) => entry.user_id === row!.user_id)
            return exists ? prev.map((entry) => (entry.user_id === row!.user_id ? row! : entry)) : [...prev, row!]
          })
        }

        if (requestId !== editRequestIdRef.current) return

        const memberForm = buildMemberProfileSavePayloadWithoutCarrier(
          memberProfileFromRow(row),
          effectiveOwnProfile
        )

        let membershipPermissions = emptyMemberPermissionConfig()
        if (effectiveOwnProfile?.organization_id) {
          const { data: membership, error: membershipError } = await supabase
            .from('organization_memberships')
            .select('permissions')
            .eq('organization_id', effectiveOwnProfile.organization_id)
            .eq('user_id', member.user_id)
            .maybeSingle()

          if (requestId !== editRequestIdRef.current) return

          if (membershipError) {
            console.warn('organization_memberships fetch for edit', membershipError)
          } else if (membership) {
            membershipPermissions = parseTeamMemberPermissions(membership.permissions)
          }
        }

        setEditingTarget({ kind: 'member_profile', id: member.id, userId: member.user_id })
        setEditingMemberKey(memberKey)
        setFormState(memberForm)
        setMemberPermissions(membershipPermissions)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }

      let row = teamRosterRows.find((entry) => entry.id === member.id)

      if (!row) {
        const { data, error } = await supabase
          .from('team_member_profiles')
          .select('*')
          .eq('id', member.id)
          .maybeSingle()

        if (requestId !== editRequestIdRef.current) return

        if (error) {
          console.warn('team_member_profiles fetch for edit', error)
          throw new Error('Could not load team member. Please try again.')
        }

        if (!data) {
          throw new Error('Team member not found.')
        }

        row = data as TeamMemberProfile
        setTeamRosterRows((prev) => {
          const exists = prev.some((entry) => entry.id === row!.id)
          return exists ? prev.map((entry) => (entry.id === row!.id ? row! : entry)) : [...prev, row!]
        })
      }

      if (requestId !== editRequestIdRef.current) return

      const rosterForm = buildMemberProfileSavePayloadWithoutCarrier(
        teamMemberProfileFromRow(row),
        effectiveOwnProfile
      )
      setEditingTarget({ kind: 'team_member_profile', id: member.id })
      setEditingMemberKey(memberKey)
      setFormState(rosterForm)
      setMemberPermissions(parseTeamMemberPermissions(row.permissions))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      if (requestId !== editRequestIdRef.current) return
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not load team member.',
      })
      resetToSelfForm()
    } finally {
      if (requestId === editRequestIdRef.current) {
        setLoadingMemberKey(null)
      }
    }
  }

  function handleAddTeamMember() {
    if (!effectiveOwnProfile || !canManageMemberPermissions(actingPermissionActor)) return
    if (!confirmDiscardIfDirty()) return

    setEditingTarget({ kind: 'team_member_profile', id: null })
    setEditingDisplayName(null)
    setEditingMemberKey(null)
    setLoadingMemberKey(null)
    setMemberPermissions(emptyMemberPermissionConfig())
    setFormState(
      buildMemberProfileSavePayloadWithoutCarrier(emptyMemberProfileForm(), effectiveOwnProfile)
    )
    setCarrierFormExpanded(false)
    setSaveMessage(null)
    setCarrierMessage(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submitRestrictedFieldChangeRequests(
    accessToken: string,
    formSnapshot: MemberProfileFormData
  ): Promise<number> {
    if (
      !effectiveOwnProfile ||
      !isDriverSelfServiceActor(effectiveOwnProfile) ||
      !isEditingOwnProfileTarget()
    ) {
      return 0
    }

    const persistedBaseline = memberProfileFromRow(effectiveOwnProfile)
    const changes = detectRestrictedFieldChanges(formSnapshot, persistedBaseline)
    if (changes.length === 0) return 0

    const response = await fetch('/api/profile-change-requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(buildRestrictedChangeRequestPayload(changes)),
    })

    const result = await response.json()
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to submit profile changes for review.')
    }

    return changes.length
  }

  async function saveViaApi(
    accessToken: string,
    payload: Record<string, unknown>
  ): Promise<{
    ok: boolean
    error?: string
    savedProfile?: MemberProfile | null
    savedRoster?: TeamMemberProfile | null
  }> {
    const response = await fetch('/api/team-member-profiles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    })

    let result: { success?: boolean; error?: string; data?: { source?: string; data?: unknown } }
    try {
      result = await response.json()
    } catch {
      return { ok: false, error: 'Invalid response from server.' }
    }

    if (!response.ok || !result.success) {
      return { ok: false, error: result.error || 'Failed to save profile.' }
    }
    return {
      ok: true,
      savedProfile: profileFromSaveResponse(result),
      savedRoster: teamMemberProfileFromSaveResponse(result),
    }
  }

  async function refreshOwnProfileAfterSave(
    supabase: ReturnType<typeof createClient>,
    userId: string,
    savedProfile: MemberProfile | null | undefined
  ): Promise<MemberProfile> {
    const { data: refreshedProfile, error } = await supabase
      .from('member_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    return resolveRefreshedOwnProfile(
      userId,
      savedProfile,
      (refreshedProfile as MemberProfile | null) ?? null,
      error
    )
  }

  function restoreEditingTargetAfterSave(
    priorTarget: ProfileEditingTarget,
    priorMemberKey: string | null,
    priorDisplayName: string | null,
    profile: MemberProfile,
    teamData: { members: MemberProfile[]; roster: TeamMemberProfile[] },
    savedRosterId?: string | null
  ) {
    if (priorTarget.kind === 'member_profile') {
      const row = teamData.members.find((entry) => entry.user_id === priorTarget.userId)
      if (!row) {
        setEditingTarget({ kind: 'self' })
        setEditingDisplayName(null)
        setEditingMemberKey(null)
        setFormState(memberProfileFromRow(profile))
        return
      }

      setEditingTarget({ kind: 'member_profile', id: priorTarget.id, userId: priorTarget.userId })
      setEditingMemberKey(priorMemberKey)
      setEditingDisplayName(priorDisplayName)
      setFormState(buildMemberProfileSavePayloadWithoutCarrier(memberProfileFromRow(row), profile))
      return
    }

    if (priorTarget.kind === 'team_member_profile') {
      const rosterId = resolvePersistedRosterId(priorTarget.id, savedRosterId)
      const row = rosterId ? teamData.roster.find((entry) => entry.id === rosterId) : null
      if (!row) {
        setEditingTarget({ kind: 'self' })
        setEditingDisplayName(null)
        setEditingMemberKey(null)
        setFormState(memberProfileFromRow(profile))
        return
      }

      const memberKey = `team_member_profile-${row.id}`
      setEditingTarget({ kind: 'team_member_profile', id: row.id })
      setEditingMemberKey(memberKey)
      setEditingDisplayName(priorDisplayName ?? memberDisplayName(row))
      setFormState(buildMemberProfileSavePayloadWithoutCarrier(teamMemberProfileFromRow(row), profile))
    }
  }

  function buildSavePayloadForTarget(
    target: ProfileEditingTarget = editingTarget,
    formSnapshot: MemberProfileFormData = form,
    profileSnapshot: MemberProfile | null = effectiveOwnProfile
  ): Record<string, unknown> {
    if (target.kind === 'team_member_profile') {
      return {
        source: 'team_member_profile',
        id: target.id ?? undefined,
        permissions: memberPermissions,
        ...buildMemberProfileSavePayloadWithoutCarrier(formSnapshot, profileSnapshot),
      }
    }

    if (target.kind === 'member_profile') {
      return {
        source: 'member_profile',
        target_user_id: target.userId,
        permissions: memberPermissions,
        ...buildMemberProfileSavePayloadWithoutCarrier(formSnapshot, profileSnapshot),
      }
    }

    const isDriverSelf = Boolean(profileSnapshot && isDriverSelfServiceActor(profileSnapshot))
    const excludeCarrier = Boolean(isPrimaryOwner(profileSnapshot)) || isDriverSelf
    const selfPayload = buildSelfMemberSavePayload(formSnapshot, profileSnapshot, { excludeCarrier })

    return {
      source: 'member_profile',
      save_scope: excludeCarrier ? 'member_only' : 'full',
      ...selfPayload,
    }
  }

  async function handleSaveCarrierInfo(e: React.SyntheticEvent) {
    e.preventDefault()
    const formSnapshot = isProfileBootstrap
      ? ensureBootstrapOwnerRoles({
          ...form,
          user_roles: [...form.user_roles],
        })
      : {
          ...form,
          user_roles: [...form.user_roles],
        }
    const actorEmail = user?.email
    const forcedCarrierOwner = isForcedCarrierOwner(actorEmail)
    if (!user || editingTarget.kind !== 'self') return
    if (!forcedCarrierOwner && !canWriteTeamData(actingPermissionActor)) return
    if (!canSaveCarrierInfo(effectiveOwnProfile, formSnapshot, actorEmail)) {
      setCarrierMessage({ type: 'error', text: CARRIER_SAVE_FORBIDDEN_MESSAGE })
      return
    }
    if (savingCarrier || savingProfile) return

    if (isProfileBootstrap) {
      const roleCheck = validateBootstrapCarrierSaveRoles(
        formSnapshot,
        effectiveOwnProfile,
        actorEmail
      )
      if (!forcedCarrierOwner && roleCheck.ok === false) {
        setCarrierMessage({ type: 'error', text: roleCheck.message })
        return
      }
    }

    const wasProfileBootstrap = isProfileBootstrap

    setSavingCarrier(true)
    setCarrierMessage(null)
    setSaveMessage(null)

    const supabase = createClient()
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    try {
      if (!accessToken) throw new Error('Session expired. Please sign in again.')

      const carrierPayload = buildCarrierOnlyApiSavePayload(
        formSnapshot,
        effectiveOwnProfile,
        actorEmail
      )
      const apiPayload = {
        source: 'member_profile',
        save_scope: 'carrier_only' as const,
        ...carrierPayload,
      }
      logCarrierSaveDebug('client before', {
        keys: Object.keys(apiPayload),
        organization_id: apiPayload.organization_id ?? null,
        company_name: apiPayload.company_name,
        save_scope: apiPayload.save_scope,
      })

      const result = await saveViaApi(accessToken, apiPayload)
      logCarrierSaveDebug('client after', {
        ok: result.ok,
        error: result.error ?? null,
        payloadOrgId: apiPayload.organization_id ?? null,
        savedOrgId: result.savedProfile?.organization_id ?? null,
        orgMatch: wasProfileBootstrap
          ? null
          : (apiPayload.organization_id ?? null) ===
            (result.savedProfile?.organization_id ?? null),
        savedCompanyName: result.savedProfile?.company_name ?? null,
      })
      if (!result.ok) {
        throw new Error(result.error?.trim() || 'Failed to save carrier information.')
      }

      const refreshed = await refreshOwnProfileAfterSave(supabase, user.id, result.savedProfile)
      const profile = mergeCarrierFieldsOntoProfile(refreshed, result.savedProfile)
      setOwnProfile(profile)
      if (profile) {
        setLinkedRosterProfile(null)
        setOrganizationMembership(
          await fetchOrganizationMembershipForOrg(supabase, user.id, profile.organization_id)
        )
      }
      setFormState(memberProfileFromRow(profile))
      setCarrierFormExpanded(false)
      await loadTeamData(supabase, user.id, profile)
      setCarrierMessage({
        type: 'success',
        text: wasProfileBootstrap
          ? 'Carrier information saved. Finish setup from the profile completion prompt below.'
          : 'Carrier information saved.',
      })
    } catch (error) {
      logCarrierSaveWarn('client error', error)
      setCarrierMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save carrier information.',
      })
    } finally {
      setSavingCarrier(false)
    }
  }

  async function sendTeamInviteAfterMemberSave(
    accessToken: string,
    formSnapshot: MemberProfileFormData,
    baseMessage: string
  ): Promise<{ ok: boolean; text: string }> {
    const inviteEmail = formSnapshot.driver_email?.trim() || null
    const invitePhone = formSnapshot.driver_phone?.trim() || null
    if (!inviteEmail && !invitePhone) {
      return {
        ok: false,
        text: `${baseMessage} Member saved, but no email or phone to invite.`,
      }
    }

    const inviteRole = resolveInviteRoleFromMemberRoles(formSnapshot.user_roles as string[])
    const inviteResult = await createTeamInviteViaApi(accessToken, {
      role: inviteRole,
      invite_email: inviteEmail,
      invite_phone: invitePhone,
    })

    if (!inviteResult.success) {
      return {
        ok: false,
        text: `${baseMessage} Invite failed: ${inviteResult.error || 'unknown error'}.`,
      }
    }

    await loadTeamInvites(accessToken)
    return {
      ok: true,
      text: formatInviteDeliverySummary(
        `${baseMessage} Invite sent.`,
        inviteResult.data?.invite_link,
        inviteResult.email?.stubbed,
        inviteResult.sms?.stubbed
      ),
    }
  }

  async function handleSave(e: React.FormEvent, options?: { andInvite?: boolean }) {
    e.preventDefault()
    const forcedCarrierOwner = isForcedCarrierOwner(user?.email)
    if (!user || (!forcedCarrierOwner && !canWriteTeamData(actingPermissionActor))) return
    if (savingCarrier || savingProfile) return

    if (editingTarget.kind === 'member_profile') {
      const targetMember = teamMembers.find(
        (member) => member.source === 'member_profile' && member.user_id === editingTarget.userId
      )
      if (
        !effectiveOwnProfile ||
        !targetMember ||
        !canEditMember(actingPermissionActor, targetMember)
      ) {
        setSaveMessage({ type: 'error', text: 'You do not have permission to edit this team member.' })
        return
      }
    }

    const priorTarget = editingTarget
    const priorMemberKey = editingMemberKey
    const priorDisplayName = editingDisplayName
    const wasProfileBootstrap = isProfileBootstrap
    let formForSave = form
    if (wasProfileBootstrap && priorTarget.kind === 'self') {
      const bootstrapValidation = validateBootstrapSelfSave(form)
      if (bootstrapValidation.ok === false) {
        setSaveMessage({ type: 'error', text: bootstrapValidation.message })
        return
      }
      formForSave = bootstrapValidation.form
      const roleCheck = validateBootstrapCarrierSaveRoles(
        formForSave,
        effectiveOwnProfile,
        user?.email
      )
      if (!forcedCarrierOwner && roleCheck.ok === false) {
        setSaveMessage({ type: 'error', text: roleCheck.message })
        return
      }
    } else if (
      effectiveOwnProfile &&
      isDriverSelfServiceActor(effectiveOwnProfile) &&
      isEditingOwnProfileTarget()
    ) {
      formForSave = applyDriverRestrictedFieldBaseline(
        form,
        memberProfileFromRow(effectiveOwnProfile)
      )
    }
    const savePayload = buildSavePayloadForTarget(priorTarget, formForSave, effectiveOwnProfile)
    const shouldInviteAfterSave =
      Boolean(options?.andInvite) &&
      priorTarget.kind === 'team_member_profile' &&
      !priorTarget.id

    if (shouldInviteAfterSave) {
      const inviteEmail = formForSave.driver_email?.trim()
      const invitePhone = formForSave.driver_phone?.trim()
      if (!inviteEmail && !invitePhone) {
        setSaveMessage({
          type: 'error',
          text: 'Add an email or phone number before saving and inviting.',
        })
        return
      }
    }

    setSavingProfile(true)
    if (shouldInviteAfterSave) setSavingAndInviting(true)
    setSaveMessage(null)
    setCarrierMessage(null)

    const supabase = createClient()
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    try {
      let savedOwnProfile: MemberProfile | null = null

      if (!accessToken) throw new Error('Session expired. Please sign in again.')

      const result = await saveViaApi(accessToken, savePayload)
      if (!result.ok) throw new Error(result.error)
      if (priorTarget.kind === 'self') {
        savedOwnProfile = result.savedProfile ?? null
      }

      let submittedChangeCount = 0
      let changeRequestError: string | null = null
      try {
        submittedChangeCount = await submitRestrictedFieldChangeRequests(accessToken, formForSave)
      } catch (changeError) {
        changeRequestError =
          changeError instanceof Error
            ? changeError.message
            : 'Failed to submit profile changes for review.'
      }

      const profile = await refreshOwnProfileAfterSave(supabase, user.id, savedOwnProfile)
      const wasEditingOther = priorTarget.kind !== 'self'
      const updatedName = priorDisplayName?.trim() || 'team member'
      setOwnProfile(profile)
      if (profile) {
        setLinkedRosterProfile(null)
        setOrganizationMembership(
          await fetchOrganizationMembershipForOrg(supabase, user.id, profile.organization_id)
        )
      }
      setLoadingMemberKey(null)
      setCarrierFormExpanded(false)

      const teamData = await loadTeamData(supabase, user.id, profile)

      const createdNewRosterMember =
        priorTarget.kind === 'team_member_profile' && !priorTarget.id && Boolean(result.savedRoster?.id)

      if (createdNewRosterMember) {
        setEditingTarget({ kind: 'self' })
        setEditingDisplayName(null)
        setEditingMemberKey(null)
        setFormState(memberProfileFromRow(profile))
      } else if (wasEditingOther) {
        restoreEditingTargetAfterSave(
          priorTarget,
          priorMemberKey,
          priorDisplayName,
          profile,
          teamData,
          result.savedRoster?.id ?? null
        )
      } else {
        setEditingTarget({ kind: 'self' })
        setEditingDisplayName(null)
        setEditingMemberKey(null)
        setFormState(memberProfileFromRow(profile))
      }

      const reviewSuffix =
        submittedChangeCount > 0
          ? ` ${submittedChangeCount} field change${submittedChangeCount === 1 ? '' : 's'} submitted for admin review.`
          : ''

      const baseSuccessText = wasProfileBootstrap
        ? 'Welcome! Your carrier account is ready.'
        : createdNewRosterMember
          ? 'New team member saved.'
          : wasEditingOther
            ? `Updated ${updatedName} successfully.${reviewSuffix}`
            : `Profile saved successfully.${reviewSuffix}`

      let finalText = baseSuccessText
      let finalType: 'success' | 'error' | 'warning' = 'success'

      if (shouldInviteAfterSave && accessToken) {
        const inviteOutcome = await sendTeamInviteAfterMemberSave(
          accessToken,
          formForSave,
          baseSuccessText
        )
        finalText = inviteOutcome.text
        if (!inviteOutcome.ok) {
          finalType = 'error'
        } else if (changeRequestError) {
          finalType = 'warning'
          finalText = `${inviteOutcome.text} Review submission failed: ${changeRequestError}`
        }
      } else if (changeRequestError) {
        finalType = 'warning'
        finalText = `${baseSuccessText} Review submission failed: ${changeRequestError}`
      }

      setSaveMessage({
        type: finalType,
        text: finalText,
      })

      if (isDriverSelfServiceActor(profile)) {
        await loadOwnPendingChangeRequests(supabase, user.id)
      }
      if (isPrimaryOwner(profile) && accessToken) {
        await loadAdminPendingChangeRequests(accessToken)
      }

      if (!wasProfileBootstrap) {
        requestAnimationFrame(() => {
          teamSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      }
    } catch (error) {
      console.warn('profile save', error)
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save profile. Please try again.',
      })
    } finally {
      setSavingProfile(false)
      setSavingAndInviting(false)
    }
  }

  async function handleSaveAndInvite(e: React.SyntheticEvent) {
    e.preventDefault()
    await handleSave(e as unknown as React.FormEvent, { andInvite: true })
  }

  async function handleReinviteMember(member: TeamMemberListItem) {
    if (!effectiveOwnProfile || !canManageMemberPermissions(actingPermissionActor)) return

    const memberKey = memberListKey(member)
    const contact = resolveMemberInviteContact(member, orgMemberRows, teamRosterRows)
    if (!canReinviteMember(actingPermissionActor, member, contact)) return

    setReinvitingMemberKey(memberKey)
    setSaveMessage(null)

    try {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Session expired. Please sign in again.')

      const inviteRole = resolveInviteRoleFromMemberRoles(member.user_roles)
      const inviteResult = await createTeamInviteViaApi(accessToken, {
        role: inviteRole,
        invite_email: contact.email,
        invite_phone: contact.phone,
      })

      if (!inviteResult.success) {
        throw new Error(inviteResult.error || 'Failed to create invite')
      }

      await loadTeamInvites(accessToken)
      setSaveMessage({
        type: 'success',
        text: formatInviteDeliverySummary(
          `Re-invite sent to ${member.display_name}.`,
          inviteResult.data?.invite_link,
          inviteResult.email?.stubbed,
          inviteResult.sms?.stubbed
        ),
      })
    } catch (error) {
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to re-invite member',
      })
    } finally {
      setReinvitingMemberKey(null)
    }
  }

  async function acceptInviteAsCurrentUser(invite: TeamInviteRow) {
    setAcceptingInviteId(invite.id)
    setSaveMessage(null)

    try {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Session expired. Please sign in again.')

      const response = await fetch('/api/team-invites/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ token: invite.invite_token }),
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to accept invite')
      }

      await loadTeamInvites(accessToken)
      if (effectiveOwnProfile?.organization_id) {
        await loadTeamData(supabase, user!.id, effectiveOwnProfile)
      }
      setSaveMessage({ type: 'success', text: 'Invite accepted for current user.' })
    } catch (error) {
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to accept invite',
      })
    } finally {
      setAcceptingInviteId(null)
    }
  }

  async function confirmDeleteMember() {
    if (!deleteCandidate || !user || !effectiveOwnProfile) return

    setDeletingId(deleteCandidate.id)
    setSaveMessage(null)

    try {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Session expired. Please sign in again.')

      const params = new URLSearchParams({ source: deleteCandidate.source })
      if (deleteCandidate.user_id) params.set('user_id', deleteCandidate.user_id)

      const response = await fetch(`/api/team-member-profiles/${deleteCandidate.id}?${params}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to delete team member.')
      }

      await loadTeamData(supabase, user.id, effectiveOwnProfile)
      if (
        editingTarget.kind === 'member_profile' &&
        editingTarget.userId === deleteCandidate.user_id
      ) {
        resetToSelfForm()
      }
      if (
        editingTarget.kind === 'team_member_profile' &&
        editingTarget.id === deleteCandidate.id
      ) {
        resetToSelfForm()
      }

      if (result.data?.deletion_request) {
        setSaveMessage({
          type: 'success',
          text: 'Removal request submitted for owner/admin approval.',
        })
      } else {
        setSaveMessage({ type: 'success', text: 'Team member removed.' })
      }

      requestAnimationFrame(() => {
        teamSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch (error) {
      console.warn('team member delete', error)
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to delete team member.',
      })
    } finally {
      setDeletingId(null)
      setDeleteCandidate(null)
      setDeleteCandidateIsRequest(false)
    }
  }

  async function respondToDeletionRequest(requestId: string, action: 'approve' | 'reject') {
    setReviewingDeletionRequestId(requestId)
    setSaveMessage(null)

    try {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Session expired. Please sign in again.')

      const response = await fetch('/api/deletion-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ id: requestId, action }),
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to review deletion request')
      }

      await loadAdminDeletionRequests(accessToken)
      if (effectiveOwnProfile?.organization_id) {
        await loadTeamData(supabase, user!.id, effectiveOwnProfile)
      }
      setSaveMessage({
        type: 'success',
        text: action === 'approve' ? 'Removal approved and applied.' : 'Removal request rejected.',
      })
    } catch (error) {
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to review deletion request',
      })
    } finally {
      setReviewingDeletionRequestId(null)
    }
  }

  async function handleCreateTeamInvite(e: React.SyntheticEvent) {
    e.preventDefault()
    if (!effectiveOwnProfile || !canManageMemberPermissions(actingPermissionActor)) return

    setCreatingInvite(true)
    setSaveMessage(null)

    try {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Session expired. Please sign in again.')

      const response = await fetch('/api/team-invites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          role: inviteRole,
          invite_email: inviteEmail.trim() || null,
          invite_phone: invitePhone.trim() || null,
        }),
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to create invite')
      }

      setInviteEmail('')
      setInvitePhone('')
      await loadTeamInvites(accessToken)
      setSaveMessage({
        type: 'success',
        text: formatInviteDeliverySummary(
          'Team invite created.',
          result.data?.invite_link,
          result.email?.stubbed,
          result.sms?.stubbed
        ),
      })
    } catch (error) {
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to create invite',
      })
    } finally {
      setCreatingInvite(false)
    }
  }

  async function revokeTeamInvite(inviteId: string) {
    setRevokingInviteId(inviteId)
    setSaveMessage(null)

    try {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Session expired. Please sign in again.')

      const response = await fetch('/api/team-invites', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ id: inviteId }),
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to revoke invite')
      }

      await loadTeamInvites(accessToken)
      setSaveMessage({ type: 'success', text: 'Invite revoked.' })
    } catch (error) {
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to revoke invite',
      })
    } finally {
      setRevokingInviteId(null)
    }
  }

  const showOwnerBootstrapSetup = shouldShowOwnerBootstrapSetupCard(editingTarget, isProfileBootstrap)
  const primaryOwner = isPrimaryOwner(effectiveOwnProfile)
  const editingLabel =
    shouldShowLandingProfileView(editingTarget, editingMemberKey, isProfileBootstrap) ||
    showOwnerBootstrapSetup
      ? null
      : editingTarget.kind === 'team_member_profile' && !editingTarget.id
        ? 'New Team Member'
        : editingTarget.kind === 'self'
          ? 'Your profile'
          : `Editing ${editingDisplayName?.trim() || 'team member'}`

  const saveButtonLabel = memberEditSaveButtonLabel(savingProfile, editingTarget)
  const showMemberSaveInHeader = shouldShowMemberSaveInCardHeader(editingTarget)
  const memberCardTitle = memberEditCardTitle(editingTarget, editingDisplayName)
  const showLandingView = shouldShowLandingProfileView(editingTarget, editingMemberKey, isProfileBootstrap)
  const showMemberEditCard = shouldShowMemberEditCard(
    editingTarget,
    editingMemberKey,
    isProfileBootstrap,
    effectiveOwnProfile
  )
  const persistedProfileBaseline = memberProfileFromRow(effectiveOwnProfile)
  const pendingFieldKeys = pendingProfileChangeFieldKeys(ownPendingChangeRequests)
  const showDriverRestrictedWarning =
    effectiveOwnProfile &&
    isDriverSelfServiceActor(effectiveOwnProfile) &&
    isEditingOwnProfileTarget() &&
    hasPendingRestrictedFieldEdits(form, persistedProfileBaseline)
  const showEditMyProfileButton = shouldShowEditMyProfileOnLanding(
    editingTarget,
    editingMemberKey,
    isProfileBootstrap,
    effectiveOwnProfile,
    Boolean(effectiveOwnProfile && isDriverSelfServiceActor(effectiveOwnProfile))
  )

  const showTeamSection = shouldShowTeamSection(effectiveOwnProfile, teamMembers)
  // Write/manage gates: prefer acting SSoT for home org over raw home user_roles alone.
  const canWriteProfile = canWriteTeamData(actingPermissionActor)
  const canEditRoles =
    editingTarget.kind !== 'self'
      ? canManageMemberPermissions(actingPermissionActor)
      : canSelfEditRoles(effectiveOwnProfile)
  const canEditMemberPermissions =
    (editingTarget.kind === 'team_member_profile' || editingTarget.kind === 'member_profile') &&
    canManageMemberPermissions(actingPermissionActor)
  const teamRoleOptions = ASSIGNABLE_TEAM_ROLES
  const showTeamInvitesSection = canManageMemberPermissions(actingPermissionActor)
  const showDevInviteTesting = isDevAccountSwitcherEnabled()
  const showSaveAndInviteButton =
    isNewTeamMemberTarget(editingTarget) && canManageMemberPermissions(actingPermissionActor)
  const editingMember =
    editingMemberKey != null
      ? teamMembers.find((member) => memberListKey(member) === editingMemberKey) ?? null
      : null
  const showMemberCardActions =
    editingMember != null &&
    editingTarget.kind !== 'self' &&
    !isNewTeamMemberTarget(editingTarget)
  const editingMemberInviteContact = editingMember
    ? resolveMemberInviteContact(editingMember, orgMemberRows, teamRosterRows)
    : null
  const allowCardReinvite =
    editingMember && effectiveOwnProfile && editingMemberInviteContact
      ? canReinviteMember(actingPermissionActor, editingMember, editingMemberInviteContact)
      : false
  const allowCardDelete =
    editingMember && effectiveOwnProfile
      ? canDeleteMember(actingPermissionActor, editingMember)
      : false
  const allowCardRequestRemoval =
    editingMember && effectiveOwnProfile
      ? canRequestMemberRemoval(actingPermissionActor, editingMember)
      : false
  const ownerBadgeRole =
    homeActingActor.membershipRole === 'Admin'
      ? 'Admin'
      : homeActingActor.is_primary_owner || homeActingActor.membershipRole === 'Owner'
        ? 'Owner'
        : ownerAdminBadgeRole(effectiveOwnProfile)
  const actorEmail = user?.email
  const forcedCarrierOwner = isForcedCarrierOwner(actorEmail)
  const canManageCarrier = canSaveCarrierInfo(effectiveOwnProfile, form, actorEmail)
  const showCarrierCard = shouldShowCarrierInformationCard(
    editingTarget,
    primaryOwner || forcedCarrierOwner,
    isProfileBootstrap,
    form,
    actorEmail
  )
  const showOwnerAdminBadge = shouldShowOwnerAdminBadge(
    {
      is_primary_owner: homeActingActor.is_primary_owner,
      user_roles: homeActingActor.user_roles,
    },
    editingTarget,
    showLandingView
  )
  const showAssignedRoleBadges = shouldShowAssignedRoleBadges(
    {
      is_primary_owner: homeActingActor.is_primary_owner,
      user_roles: homeActingActor.user_roles,
    },
    editingTarget,
    showLandingView
  )
  const landingAssignedRoles =
    homeActingActor.user_roles.length > 0
      ? homeActingActor.user_roles
      : getLandingAssignedRoles(effectiveOwnProfile)
  const showUserRolesSection = shouldShowUserRolesSection(editingTarget)
  const memberEditSubtitle = getMemberEditCardSubtitle(editingTarget)
  const showTeamSectionCarrier = shouldShowTeamSectionCarrierBlock(editingTarget)
  const orgCarrierSource = memberProfileFromRow(effectiveOwnProfile)
  const carrierDataSource = resolveCarrierDataSource(
    editingTarget,
    form,
    effectiveOwnProfile,
    carrierFormExpanded
  )
  const teamSectionCarrierSource = orgCarrierSource
  const carrierSummaryMode = shouldUseCarrierSummaryMode(editingTarget, carrierDataSource)
  const showCarrierForm = shouldShowCarrierForm(editingTarget, carrierDataSource, carrierFormExpanded)
  const showTeamSectionCarrierDetails = shouldShowTeamSectionCarrierDetails(
    teamSectionCarrierSource,
    carrierFormExpanded
  )
  const teamMemberCarrierSummaryMode = shouldUseTeamMemberCarrierSummary(
    editingTarget,
    teamSectionCarrierSource,
    carrierFormExpanded
  )
  const carrierSummaryFields = formatCarrierSummaryDisplay(carrierDataSource)
  const teamSectionCarrierFields = formatCarrierSummaryDisplay(teamSectionCarrierSource)
  const carrierNameSummary = formatCarrierNameSummary(teamSectionCarrierSource)
  const showEditCarrierButton =
    (canWriteProfile || forcedCarrierOwner) &&
    canManageCarrier &&
    carrierSummaryMode &&
    editingTarget.kind === 'self' &&
    !carrierFormExpanded
  const showSaveCarrierInfoButton =
    editingTarget.kind === 'self' && showCarrierForm && canManageCarrier
  const isLoadingMember = loadingMemberKey !== null
  const carrierSaveInFlight = savingCarrier || savingProfile
  const isSaving = isAnySaveInFlight(savingCarrier, savingProfile)
  const memberSaveDisabled = memberEditSaveDisabled(editingTarget, {
    isSaving,
    canWriteProfile,
    forcedCarrierOwner,
    isLoadingMember,
    userRoles: (form.user_roles as string[]) || [],
  })
  const showBootstrapProfilePrompt = shouldShowBootstrapProfilePrompt(effectiveOwnProfile)
  // Form toggle for bootstrap checkbox; landing Operator badge uses acting SSoT.
  const ownerOperatorSelected = isOwnerOperatorSelected((form.user_roles as string[]) || [])
  const showOperatorBadge = homeActingActor.isOwnerOperator
  const bootstrapSaveButtonLabel = getOwnerBootstrapSaveButtonLabel(savingProfile)
  const onboardingPersona = resolveOnboardingPersona({
    actorEmail: user?.email,
    ownProfile: effectiveOwnProfile,
    linkedRoster: linkedRosterProfile,
    organizationMembership,
    userRoles:
      homeActingActor.user_roles.length > 0
        ? homeActingActor.user_roles
        : (effectiveOwnProfile?.user_roles as string[]) || (form.user_roles as string[]) || [],
    isPrimaryOwner:
      homeActingActor.is_primary_owner ||
      effectiveOwnProfile?.is_primary_owner === true ||
      isProfileBootstrap,
  })
  const bootstrapWelcomeTitle = getBootstrapWelcomeTitle(onboardingPersona)
  const bootstrapWelcomeSubtitle = getBootstrapWelcomeSubtitle(onboardingPersona)
  const setupActor = {
    user_roles: homeActingActor.user_roles,
    is_primary_owner: homeActingActor.is_primary_owner,
  }
  const guidedStep = resolveOnboardingStep({
    incompleteOnboarding: isProfileBootstrap,
    ownProfile: effectiveOwnProfile,
    teamMemberCount: orgMemberProfileCount,
    hasEquipment: hasOrgEquipment,
    dismissedGuidedSteps: guidedStepsDismissed,
    canManageSetup: canSeeSetupGuidance(setupActor),
  })
  const roleWelcomeHeadline = getWelcomeHeadline(onboardingPersona)
  const roleWelcomeSubtitle = getWelcomeSubtitle(onboardingPersona, {
    bootstrap: false,
    step: guidedStep,
    serviceMode: workspaceMode === 'service',
  })
  const showGuidedWelcomeBanner = shouldShowFullWelcomeBanner({
    isProfileBootstrap,
    guidedStep,
  })
  const showTeamRoleWelcome = shouldShowTeamRoleWelcome({
    persona: onboardingPersona,
    guidedStep,
    isProfileBootstrap,
    roleWelcomeSeen,
  })
  const showFullWelcomeBanner = showGuidedWelcomeBanner || showTeamRoleWelcome
  const showGuidedNextSteps =
    !isProfileBootstrap &&
    showLandingView &&
    guidedStep === 'team_or_equipment' &&
    canSeeSetupGuidance(setupActor)
  const guidedCopy = getGuidedOnboardingCopy(guidedStep)
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-14 h-14 bg-black rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <span className="text-white text-3xl font-bold tracking-tighter">T</span>
          </div>
          <p className="text-gray-700 font-semibold text-lg">Checking authentication...</p>
          <p className={`${mutedTextClass} text-sm mt-1`}>Please wait while we verify your session</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        user={user}
        activePage="profile"
        ownOrganizationId={effectiveOwnProfile?.organization_id ?? ownProfile?.organization_id}
      />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 min-w-0">
        {!showOwnerBootstrapSetup && (
          <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">Member Profile</h1>
              <p className={`${bodyTextClass} mt-1.5 text-[15px]`}>
                Keep carrier and driver details ready for permits and team coordination.
              </p>
              {showAssignedRoleBadges && (
                <p className={`mt-3 text-sm ${bodyTextClass}`}>
                  Your assigned roles:{' '}
                  {landingAssignedRoles.map((role) => (
                    <span
                      key={role}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border mr-1.5 ${roleBadgeClass(role as Parameters<typeof roleBadgeClass>[0])}`}
                    >
                      {role}
                    </span>
                  ))}
                </p>
              )}
            </div>
            {/* History instead of redundant Dashboard/Profile links already in AppHeader */}
            <div className="flex flex-wrap gap-2 sm:gap-3 shrink-0">
              <a href="/history" className={buttonSecondaryClass}>
                History
              </a>
            </div>
          </div>
        )}

        {saveMessage && (
          <div
            role="status"
            aria-live="polite"
            className={`mb-4 rounded-xl px-4 py-3 text-sm ${
              saveMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : saveMessage.type === 'warning'
                  ? 'bg-amber-50 text-amber-900 border border-amber-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {saveMessage.text}
          </div>
        )}

        {editingLabel && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <span className="font-medium">
              {isLoadingMember ? 'Loading team member…' : editingLabel}
            </span>
            <button
              type="button"
              onClick={() => {
                if (confirmDiscardIfDirty()) resetToSelfForm()
              }}
              disabled={isLoadingMember || isSaving}
              className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-blue-900 hover:bg-blue-100 transition disabled:opacity-50"
            >
              Cancel editing
            </button>
          </div>
        )}

        {showOwnerBootstrapSetup && (
          <form onSubmit={handleSave} className="mb-6">
            <section className={`${cardClass} shadow-sm`}>
              <div className="mb-6">
                <p className={`text-xs font-semibold uppercase tracking-wide ${mutedTextClass} mb-2`}>
                  {getGuidedOnboardingCopy('company').title}
                </p>
                <h2 className="font-semibold text-xl tracking-tight text-gray-900">
                  {bootstrapWelcomeTitle}
                </h2>
                <p className={`${fieldHintClass} mt-1.5`}>{bootstrapWelcomeSubtitle}</p>
              </div>

              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Your Contact Info</h3>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {BOOTSTRAP_CONTACT_FIELDS.map(({ key, label, type = 'text', placeholder }) => (
                      <div key={key}>
                        <label htmlFor={`bootstrap-${key}`} className={fieldLabelClass}>
                          {label}
                        </label>
                        <input
                          id={`bootstrap-${key}`}
                          type={type}
                          value={(form[key] as string) ?? ''}
                          onChange={(e) => updateField(key, e.target.value)}
                          placeholder={placeholder}
                          className={inputClass}
                          disabled={isFieldDisabled(key)}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Carrier Details</h3>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {BOOTSTRAP_CARRIER_FIELDS.map(({ key, label, type = 'text', placeholder }) => (
                      <div key={key} className={key === 'carrier_address' ? 'sm:col-span-2' : ''}>
                        <label htmlFor={`bootstrap-${key}`} className={fieldLabelClass}>
                          {label}
                        </label>
                        <input
                          id={`bootstrap-${key}`}
                          type={type}
                          value={(form[key] as string) ?? ''}
                          onChange={(e) => updateField(key, e.target.value)}
                          placeholder={placeholder}
                          className={inputClass}
                          disabled={isFieldDisabled(key)}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`pt-4 border-t ${softDividerBorderClass}`}>
                  <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-300 sm:border-gray-200 px-4 py-3 hover:bg-gray-50 transition">
                    <input
                      type="checkbox"
                      checked={ownerOperatorSelected}
                      onChange={(e) => toggleOwnerOperator(e.target.checked)}
                      disabled={isSaving || isLoadingMember}
                      className={`mt-0.5 ${checkboxClass}`}
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-900">Owner Operator</span>
                      <span className={`block ${fieldHintClass} mt-0.5`}>
                        I also drive — add the Driver role so you can manage equipment and operate on
                        routes.
                      </span>
                      {ownerOperatorSelected && (
                        <span className={`block text-xs ${mutedTextClass} mt-1.5`}>
                          {getOwnerBootstrapOwnerOperatorHint()}
                        </span>
                      )}
                    </span>
                  </label>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={memberSaveDisabled}
                    className={buttonPrimaryClass}
                  >
                    {bootstrapSaveButtonLabel}
                  </button>
                </div>
              </div>
            </section>
          </form>
        )}

        {/* Full welcome while onboarding incomplete; one-time quiet banner for team roles */}
        {!showOwnerBootstrapSetup && showLandingView && showFullWelcomeBanner && (
          <div className={`mb-6 rounded-2xl border border-gray-300 sm:border-gray-200 bg-white p-6 shadow-sm`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-xl tracking-tight text-gray-900">
                  {roleWelcomeHeadline}
                </h2>
                <p className={`${fieldHintClass} mt-1.5`}>{roleWelcomeSubtitle}</p>
              </div>
              {showTeamRoleWelcome && user?.id && (
                <button
                  type="button"
                  onClick={() => {
                    writeRoleWelcomeSeen(user.id, true)
                    setRoleWelcomeSeen(true)
                  }}
                  className={`text-sm font-medium ${bodyTextClass} hover:text-black`}
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        )}

        {showGuidedNextSteps && (
          <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800 mb-2">
              {guidedCopy.title}
            </p>
            <h2 className="font-semibold text-lg tracking-tight text-emerald-950">
              What would you like to set up next?
            </h2>
            <p className="text-sm text-emerald-900/80 mt-1.5">{guidedCopy.body}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  requestAnimationFrame(() => {
                    teamSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  })
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-900 transition"
              >
                Build your team
              </button>
              <a
                href="/equipment"
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-5 py-2.5 text-sm font-semibold text-emerald-950 hover:bg-emerald-100 transition"
              >
                Add equipment
              </a>
              <a
                href="/dashboard"
                onClick={() => {
                  if (user?.id) {
                    writeOnboardingGuidedDismissed(user.id, true)
                    setGuidedStepsDismissed(true)
                  }
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-transparent px-5 py-2.5 text-sm font-semibold text-emerald-900 hover:underline"
              >
                Go to Dashboard
              </a>
            </div>
          </div>
        )}

        {showCarrierCard && (
          <section className={`${cardClass} mb-6`}>
            <form onSubmit={handleSaveCarrierInfo} className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-lg tracking-tight text-gray-900">Carrier Information</h2>
                    <p className={`${fieldHintClass} mt-1`}>
                      Company details used on permits and compliance forms. Use Save Carrier Info below.
                    </p>
                    {showOwnerAdminBadge && (
                      <p className={`mt-2 text-sm ${bodyTextClass}`}>
                        You are{' '}
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${roleBadgeClass(ownerBadgeRole)}`}
                        >
                          {ownerBadgeRole}
                        </span>
                        {/* Owner Operator: membership label stays Owner; Operator badge from acting SSoT (§4.1). */}
                        {showOperatorBadge && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-emerald-50 text-emerald-800 border-emerald-200 ml-1.5">
                            Operator
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  {showEditCarrierButton && (
                    <button
                      type="button"
                      onClick={() => setCarrierFormExpanded(true)}
                      disabled={carrierSaveInFlight}
                      className={buttonSecondaryClass}
                    >
                      Edit Carrier Info
                    </button>
                  )}
                  {canManageCarrier && carrierSummaryMode && editingTarget.kind === 'self' && carrierFormExpanded && (
                    <button
                      type="button"
                      onClick={handleCollapseCarrier}
                      disabled={carrierSaveInFlight}
                      className={buttonSecondaryClass}
                    >
                      Collapse
                    </button>
                  )}
                </div>
                {showCarrierForm ? (
                  <>
                    <div className="grid sm:grid-cols-2 gap-4">
                      {CARRIER_FIELDS.map(({ key, label, type = 'text', placeholder }) => (
                        <div key={key} className={key === 'carrier_address' ? 'sm:col-span-2' : ''}>
                          <label htmlFor={key} className={fieldLabelClass}>
                            {label}
                          </label>
                          <input
                            id={key}
                            type={type}
                            value={(form[key] as string) ?? ''}
                            onChange={(e) => updateField(key, e.target.value)}
                            placeholder={placeholder}
                            className={inputClass}
                            disabled={carrierSaveInFlight}
                          />
                        </div>
                      ))}
                    </div>
                    {showSaveCarrierInfoButton && (
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={carrierSaveInFlight}
                          className={buttonPrimaryClass}
                        >
                          {savingCarrier ? 'Saving...' : 'Save Carrier Info'}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                    {carrierSummaryFields.map(({ label, value }) => (
                      <div key={label} className={label === 'Address' ? 'sm:col-span-2' : ''}>
                        <dt className={`text-xs font-medium ${mutedTextClass}`}>{label}</dt>
                        <dd className="mt-1 text-sm text-gray-900">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {carrierMessage && (
                  <div
                    role="status"
                    aria-live="polite"
                    className={`rounded-xl px-4 py-3 text-sm ${
                      carrierMessage.type === 'success'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-red-50 text-red-800 border border-red-200'
                    }`}
                  >
                    {carrierMessage.text}
                  </div>
                )}
            </form>
          </section>
        )}

        {showMemberEditCard && (
        <form onSubmit={handleSave} className="space-y-6 mb-6">
          <section className={cardClass}>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
              <div>
                <h2 className="font-semibold text-lg tracking-tight text-gray-900">{memberCardTitle}</h2>
                <p className={`${fieldHintClass} mt-1`}>{memberEditSubtitle}</p>
              </div>
              {showMemberSaveInHeader && (
                <button
                  type="submit"
                  disabled={memberSaveDisabled}
                  className={buttonPrimaryCompactClass}
                >
                  {saveButtonLabel}
                </button>
              )}
            </div>

            {showDriverRestrictedWarning && (
              <div
                role="status"
                aria-live="polite"
                className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                <p className="font-medium">Requires Admin approval</p>
                <p className="mt-1">
                  Changes to name, CDL, or date of birth will be submitted for review when you save. Contact
                  fields save immediately.
                </p>
              </div>
            )}

            {showMemberCardActions &&
              (allowCardReinvite || allowCardDelete || allowCardRequestRemoval) && (
                <div className={`mt-4 ${nestedPanelClass}`}>
                  <p className={`text-xs font-medium ${mutedTextClass} mb-3`}>Member actions</p>
                  <div className="flex flex-wrap gap-2">
                    {allowCardReinvite && editingMember && (
                      <button
                        type="button"
                        onClick={() => void handleReinviteMember(editingMember)}
                        disabled={reinvitingMemberKey === editingMemberKey || isSaving}
                        className={buttonSuccessOutlineClass}
                      >
                        {reinvitingMemberKey === editingMemberKey ? 'Inviting…' : 'Re-invite'}
                      </button>
                    )}
                    {allowCardDelete && editingMember && (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteCandidateIsRequest(false)
                          setDeleteCandidate(editingMember)
                        }}
                        disabled={deletingId === editingMember.id}
                        className="text-sm px-3 py-1.5 border border-red-200 hover:bg-red-50 rounded-lg text-red-700 transition disabled:opacity-50"
                      >
                        {deletingId === editingMember.id ? 'Deleting...' : 'Delete'}
                      </button>
                    )}
                    {allowCardRequestRemoval && !allowCardDelete && editingMember && (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteCandidateIsRequest(true)
                          setDeleteCandidate(editingMember)
                        }}
                        disabled={deletingId === editingMember.id}
                        className="text-sm px-3 py-1.5 border border-amber-200 hover:bg-amber-50 rounded-lg text-amber-800 transition disabled:opacity-50"
                      >
                        {deletingId === editingMember.id ? 'Submitting...' : 'Request removal'}
                      </button>
                    )}
                  </div>
                </div>
              )}

            {showTeamSectionCarrier && (
              <div className={`mb-5 ${nestedPanelClass}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className={`text-xs font-medium ${mutedTextClass}`}>Carrier</p>
                    <p className="text-sm font-medium text-gray-900 mt-0.5">{carrierNameSummary}</p>
                  </div>
                  {hasCarrierData(teamSectionCarrierSource) && (
                    <button
                      type="button"
                      onClick={() => setCarrierFormExpanded((prev) => !prev)}
                      className={buttonSecondaryClass}
                    >
                      {carrierFormExpanded ? 'Collapse' : 'Expand'}
                    </button>
                  )}
                </div>
                {showTeamSectionCarrierDetails && (
                  <dl className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-4">
                    {teamSectionCarrierFields.map(({ label, value }) => (
                      <div key={`team-carrier-${label}`} className={label === 'Address' ? 'sm:col-span-2' : ''}>
                        <dt className={`text-xs font-medium ${mutedTextClass}`}>{label}</dt>
                        <dd className="mt-1 text-sm text-gray-900">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className={`mt-2 text-xs ${mutedTextClass}`}>
                  {getTeamSectionCarrierHelperText({
                    showExpandableSummary: teamMemberCarrierSummaryMode,
                  })}
                </p>
              </div>
            )}

            <div className="mt-5 grid sm:grid-cols-2 gap-4">
              {DRIVER_IDENTITY_FIELDS.map(({ key, label, type = 'text', placeholder }) => (
                <div key={key}>
                  <label htmlFor={key} className={fieldLabelClass}>
                    {label}
                    {isDriverRestrictedField(key) &&
                      effectiveOwnProfile &&
                      isDriverSelfServiceActor(effectiveOwnProfile) &&
                      isEditingOwnProfileTarget() && (
                        <span className="ml-1 text-amber-700">(requires approval)</span>
                      )}
                    {pendingFieldKeys.has(key) && (
                      <span className="ml-1 text-blue-700">(pending approval)</span>
                    )}
                  </label>
                  <input
                    id={key}
                    type={type}
                    value={(form[key] as string) ?? ''}
                    onChange={(e) => updateField(key, e.target.value)}
                    placeholder={placeholder}
                    className={inputClass}
                    disabled={isFieldDisabled(key)}
                  />
                </div>
              ))}
              <div>
                <label htmlFor="cdl_state" className={fieldLabelClass}>
                  CDL State
                  {effectiveOwnProfile &&
                    isDriverSelfServiceActor(effectiveOwnProfile) &&
                    isEditingOwnProfileTarget() && (
                    <span className="ml-1 text-amber-700">(requires approval)</span>
                  )}
                  {pendingFieldKeys.has('cdl_state') && (
                    <span className="ml-1 text-blue-700">(pending approval)</span>
                  )}
                </label>
                <select
                  id="cdl_state"
                  value={form.cdl_state ?? ''}
                  onChange={(e) => updateField('cdl_state', e.target.value)}
                  disabled={isFieldDisabled('cdl_state')}
                  className={`${inputClass} min-h-[38px] disabled:opacity-50`}
                >
                  <option value="">— Select state —</option>
                  {US_STATE_OPTIONS.map(({ code, name }) => (
                    <option key={code} value={code}>
                      {code} — {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="date_of_birth" className={fieldLabelClass}>
                  Date of Birth
                  {effectiveOwnProfile &&
                    isDriverSelfServiceActor(effectiveOwnProfile) &&
                    isEditingOwnProfileTarget() && (
                    <span className="ml-1 text-amber-700">(requires approval)</span>
                  )}
                  {pendingFieldKeys.has('date_of_birth') && (
                    <span className="ml-1 text-blue-700">(pending approval)</span>
                  )}
                </label>
                <input
                  id="date_of_birth"
                  type="date"
                  max={maxDateOfBirth}
                  value={form.date_of_birth ?? ''}
                  onChange={(e) => updateField('date_of_birth', e.target.value)}
                  className={inputClass}
                  disabled={isFieldDisabled('date_of_birth')}
                />
              </div>
              {DRIVER_CONTACT_FIELDS.map(({ key, label, type = 'text', placeholder }) => (
                <div key={key} className={key === 'emergency_contact' ? 'sm:col-span-2' : ''}>
                  <label htmlFor={key} className={fieldLabelClass}>
                    {label}
                  </label>
                  <input
                    id={key}
                    type={type}
                    value={(form[key] as string) ?? ''}
                    onChange={(e) => updateField(key, e.target.value)}
                    placeholder={placeholder}
                    className={inputClass}
                    disabled={isFieldDisabled(key)}
                  />
                </div>
              ))}
            </div>

            {showUserRolesSection && (
              <div className={`mt-6 pt-6 border-t ${softDividerBorderClass}`}>
                <UserRolesCheckboxGrid
                  userRoles={(form.user_roles as string[]) || []}
                  roleOptions={teamRoleOptions}
                  canEditRoles={canEditRoles}
                  canWriteProfile={canWriteProfile}
                  disabled={isLoadingMember || isSaving}
                  helperText={getTeamMemberRolesHelperText(canEditRoles)}
                  onToggleRole={toggleRole}
                />
                {canEditMemberPermissions && (
                  <MemberPermissionsEditor
                    permissions={memberPermissions}
                    canEdit={canEditMemberPermissions}
                    disabled={isLoadingMember || isSaving}
                    onChange={setMemberPermissions}
                  />
                )}
                {!showMemberSaveInHeader && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={memberSaveDisabled || savingAndInviting}
                      className={buttonPrimaryCompactClass}
                    >
                      {saveButtonLabel}
                    </button>
                    {showSaveAndInviteButton && (
                      <button
                        type="button"
                        onClick={handleSaveAndInvite}
                        disabled={memberSaveDisabled || savingAndInviting}
                        className={`${buttonSuccessClass} rounded-lg px-4 py-2 whitespace-nowrap`}
                      >
                        {savingAndInviting ? 'Saving & inviting…' : 'Save and Invite'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {showBootstrapProfilePrompt && editingTarget.kind === 'self' && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Carrier details are saved. Add your driver information here, then click Save Profile to finish
              setup.
            </p>
          )}
        </form>
        )}

        {showTeamSection && (
          <section
            ref={teamSectionRef}
            id="saved-team-members"
            className={`${cardSectionClass} ${showLandingView ? 'mb-6' : 'mt-6'}`}
          >
            <div className={`${sectionHeaderClass} flex flex-wrap items-start justify-between gap-3`}>
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-gray-900">Team Roster</h2>
                <p className={`${fieldHintClass} mt-1`}>
                  {primaryOwner
                    ? 'Manage profiles for everyone on your team.'
                    : 'Your saved profile details.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {showEditMyProfileButton && (
                  <button
                    type="button"
                    onClick={handleEditMyProfile}
                    disabled={isLoadingMember || isSaving}
                    className={`${buttonSecondaryClass} font-semibold whitespace-nowrap`}
                  >
                    Edit my profile
                  </button>
                )}
                {canManageMemberPermissions(actingPermissionActor) && canWriteProfile && (
                  <button
                    type="button"
                    onClick={handleAddTeamMember}
                    disabled={isLoadingMember || isSaving}
                    className={buttonPrimaryCompactClass}
                  >
                    + Add New Member
                  </button>
                )}
              </div>
            </div>

            {teamMembers.length === 0 ? (
              <div className={`px-6 py-10 text-center ${fieldHintClass}`}>
                Save your profile to see it listed here.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={`bg-gray-50 border-b ${dividerBorderClass}`}>
                    <tr>
                      <th className="text-left px-6 py-4 font-semibold text-gray-700">Name</th>
                      <th className="text-left px-6 py-4 font-semibold text-gray-700">Roles</th>
                      <th className="text-left px-6 py-4 font-semibold text-gray-700">Company</th>
                      <th className="text-left px-6 py-4 font-semibold text-gray-700">Driver Info</th>
                      <th className="text-right px-6 py-4 font-semibold text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className={listDivideClass}>
                    {teamMembers.map((member) => {
                      const allowEdit = effectiveOwnProfile
                        ? canEditMember(actingPermissionActor, member)
                        : member.is_self

                      const rowKey = memberListKey(member)
                      const isEditingRow = editingMemberKey === rowKey

                      return (
                        <tr
                          key={rowKey}
                          className={`transition-colors ${
                            isEditingRow ? 'bg-blue-50 hover:bg-blue-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <td className="px-6 py-4">
                            <div className="font-medium text-gray-900">{member.display_name}</div>
                            {member.is_self && (
                              <div className={`text-xs ${mutedTextClass} mt-0.5`}>You</div>
                            )}
                            {member.is_primary_owner && !member.is_self && (
                              <div className={`text-xs ${mutedTextClass} mt-0.5`}>Primary owner</div>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-wrap gap-1.5">
                              {member.user_roles.length > 0 ? (
                                member.user_roles.map((role, index) => (
                                  <span
                                    key={`${role}-${index}`}
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${roleBadgeClass(role)}`}
                                  >
                                    {role}
                                  </span>
                                ))
                              ) : (
                                <span className={mutedTextClass}>—</span>
                              )}
                            </div>
                          </td>
                          <td className={`px-6 py-4 ${bodyTextClass}`}>{member.company_name?.trim() || '—'}</td>
                          <td className={`px-6 py-4 ${mutedTextClass}`}>{member.driver_summary}</td>
                          <td className="px-6 py-4 text-right whitespace-nowrap">
                            {allowEdit && canWriteProfile && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirmDiscardIfDirty()) void handleEditMember(member)
                                }}
                                disabled={isLoadingMember || isSaving}
                                className={buttonSecondaryClass}
                              >
                                Edit
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {effectiveOwnProfile &&
          isDriverSelfServiceActor(effectiveOwnProfile) &&
          ownPendingChangeRequests.length > 0 && (
            <section className={`mt-10 ${cardSectionClass}`}>
              <div className={sectionHeaderClass}>
                <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                  Your Pending Profile Changes
                </h2>
                <p className={`${fieldHintClass} mt-1`}>
                  Identity updates awaiting admin approval. Contact fields save immediately.
                </p>
              </div>
              <ul className={listDivideClass}>
                {ownPendingChangeRequests.map((request) => (
                  <li key={request.id} className="px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-gray-900">
                        {profileChangeFieldLabel(request.field_key)}
                      </div>
                      <div className={`${fieldHintClass} mt-0.5`}>
                        {request.current_value?.trim() || '—'} → {request.requested_value?.trim() || '—'}
                      </div>
                      <div className="text-xs text-blue-700 mt-1 capitalize">{request.status}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => withdrawOwnProfileChangeRequest(request.id)}
                      disabled={withdrawingChangeRequestId === request.id}
                      className={buttonSecondaryClass}
                    >
                      {withdrawingChangeRequestId === request.id ? 'Withdrawing…' : 'Withdraw'}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

        {showTeamInvitesSection && (
          <section className={`mt-10 ${cardSectionClass}`}>
            <div className={sectionHeaderClass}>
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">Team Invites</h2>
              <p className={`${fieldHintClass} mt-1`}>
                Invite admins, drivers, permit clerks, or viewers by email or phone.
              </p>
            </div>
            <div className={`px-6 py-5 border-b ${dividerBorderClass}`}>
              <form onSubmit={handleCreateTeamInvite} className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="invite_email" className={fieldLabelClass}>
                    Email
                  </label>
                  <input
                    id="invite_email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className={inputClass}
                    placeholder="driver@example.com"
                    disabled={creatingInvite}
                  />
                </div>
                <div>
                  <label htmlFor="invite_phone" className={fieldLabelClass}>
                    Phone (SMS stub)
                  </label>
                  <input
                    id="invite_phone"
                    type="tel"
                    value={invitePhone}
                    onChange={(e) => setInvitePhone(e.target.value)}
                    className={inputClass}
                    placeholder="(555) 123-4567"
                    disabled={creatingInvite}
                  />
                </div>
                <div>
                  <label htmlFor="invite_role" className={fieldLabelClass}>
                    Role
                  </label>
                  <select
                    id="invite_role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    disabled={creatingInvite}
                    className={`${inputClass} min-h-[38px]`}
                  >
                    {INVITE_ALLOWED_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={creatingInvite || (!inviteEmail.trim() && !invitePhone.trim())}
                    className={buttonPrimaryCompactClass}
                  >
                    {creatingInvite ? 'Creating…' : 'Send invite'}
                  </button>
                </div>
              </form>
            </div>
            {teamInvites.length === 0 ? (
              <div className={`px-6 py-8 ${fieldHintClass}`}>No pending invites.</div>
            ) : (
              <ul className={listDivideClass}>
                {teamInvites.map((invite) => (
                  <li key={invite.id} className="px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-gray-900">{invite.role}</div>
                      <div className={`${fieldHintClass} mt-0.5`}>
                        {invite.invite_email || invite.invite_phone || 'No contact'}
                        {invite.invite_link && (
                          <span className={`block text-xs ${mutedTextClass} mt-1 truncate max-w-md`}>
                            {invite.invite_link}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {showDevInviteTesting && invite.invite_token && (
                        <>
                          <a
                            href={`/invite/${encodeURIComponent(invite.invite_token)}`}
                            className="text-sm px-3 py-1.5 rounded-lg border border-blue-200 text-blue-800 hover:bg-blue-50"
                          >
                            Open accept link
                          </a>
                          {normalizeInviteEmail(user?.email) ===
                            normalizeInviteEmail(invite.invite_email) && (
                            <button
                              type="button"
                              onClick={() => void acceptInviteAsCurrentUser(invite)}
                              disabled={acceptingInviteId === invite.id}
                              className={`text-sm px-3 py-1.5 rounded-lg ${buttonSuccessClass}`}
                            >
                              {acceptingInviteId === invite.id
                                ? 'Accepting…'
                                : 'Accept as current user'}
                            </button>
                          )}
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => revokeTeamInvite(invite.id)}
                        disabled={revokingInviteId === invite.id}
                        className={buttonSecondaryClass}
                      >
                        {revokingInviteId === invite.id ? 'Revoking…' : 'Revoke'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {canManageMemberPermissions(actingPermissionActor) && pendingDeletionRequests.length > 0 && (
          <section className={`mt-10 ${cardSectionClass}`}>
            <div className={sectionHeaderClass}>
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">Pending Removal Requests</h2>
              <p className={`${fieldHintClass} mt-1`}>
                Permit clerk deletion requests awaiting your approval.
              </p>
            </div>
            <ul className={listDivideClass}>
              {pendingDeletionRequests.map((request) => (
                <li key={request.id} className="px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-gray-900">
                      {deletionResourceLabel(request.resource_type)}
                    </div>
                    <div className={`${fieldHintClass} mt-0.5`}>Resource ID: {request.resource_id}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => respondToDeletionRequest(request.id, 'approve')}
                      disabled={reviewingDeletionRequestId === request.id}
                      className={`text-sm px-3 py-1.5 rounded-lg ${buttonSuccessClass}`}
                    >
                      {reviewingDeletionRequestId === request.id ? 'Working…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      onClick={() => respondToDeletionRequest(request.id, 'reject')}
                      disabled={reviewingDeletionRequestId === request.id}
                      className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {primaryOwner && adminPendingChangeRequests.length > 0 && (
          <section className={`mt-10 ${cardSectionClass}`}>
            <div className={sectionHeaderClass}>
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                Pending Profile Changes
              </h2>
              <p className={`${fieldHintClass} mt-1`}>
                Driver identity updates awaiting your approval.
              </p>
            </div>
            <ul className={listDivideClass}>
              {adminPendingChangeRequests.map((request) => {
                const requester = orgMemberRows.find((row) => row.user_id === request.requester_user_id)
                const requesterName = requester ? memberDisplayName(requester) : 'Team member'

                return (
                  <li key={request.id} className="px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-gray-900">{requesterName}</div>
                      <div className={`${fieldHintClass} mt-0.5`}>
                        <span className="font-medium">{profileChangeFieldLabel(request.field_key)}:</span>{' '}
                        {request.current_value?.trim() || '—'} → {request.requested_value?.trim() || '—'}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => respondToProfileChangeRequest(request.id, 'approve')}
                        disabled={reviewingChangeRequestId === request.id}
                        className={`text-sm px-3 py-1.5 rounded-lg ${buttonSuccessClass}`}
                      >
                        {reviewingChangeRequestId === request.id ? 'Working…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        onClick={() => respondToProfileChangeRequest(request.id, 'reject')}
                        disabled={reviewingChangeRequestId === request.id}
                        className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {primaryOwner && incomingLinkRequests.length > 0 && (
          <section className={`mt-10 ${cardSectionClass}`}>
            <div className={sectionHeaderClass}>
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">Account Link Requests</h2>
              <p className={`${fieldHintClass} mt-1`}>
                Permit clerks and service users requesting access to your carrier account.
              </p>
            </div>
            <ul className={listDivideClass}>
              {incomingLinkRequests.map((request) => (
                <li key={request.id} className="px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-gray-900">
                      {request.requester_name || 'Account link request'}
                    </div>
                    <div className={`${fieldHintClass} mt-0.5`}>
                      {request.requester_email && <span>{request.requester_email} · </span>}
                      {request.target_usdot && <span>USDOT {request.target_usdot} · </span>}
                      {request.target_email && <span>{request.target_email} · </span>}
                      {request.message && <span className="italic">{request.message}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => respondToLinkRequest(request.id, 'approve')}
                      disabled={respondingRequestId === request.id}
                      className={`text-sm px-3 py-1.5 rounded-lg ${buttonSuccessClass}`}
                    >
                      {respondingRequestId === request.id ? 'Working…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      onClick={() => respondToLinkRequest(request.id, 'reject')}
                      disabled={respondingRequestId === request.id}
                      className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {deleteCandidate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-gray-900">
                {deleteCandidateIsRequest ? 'Request removal?' : 'Delete team member?'}
              </h3>
              <p className={`mt-2 text-sm ${bodyTextClass}`}>
                {deleteCandidateIsRequest ? (
                  <>
                    Submit a removal request for{' '}
                    <span className="font-medium text-gray-900">{deleteCandidate.display_name}</span>? An owner or
                    admin must approve before they are removed.
                  </>
                ) : (
                  <>
                    Remove <span className="font-medium text-gray-900">{deleteCandidate.display_name}</span> from
                    your team? This cannot be undone.
                  </>
                )}
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteCandidate(null)
                    setDeleteCandidateIsRequest(false)
                  }}
                  className={buttonSecondaryClass}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteMember}
                  disabled={deletingId === deleteCandidate.id}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                    deleteCandidateIsRequest
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {deletingId === deleteCandidate.id
                    ? deleteCandidateIsRequest
                      ? 'Submitting...'
                      : 'Deleting...'
                    : deleteCandidateIsRequest
                      ? 'Request removal'
                      : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}