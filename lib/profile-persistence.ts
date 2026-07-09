import { CARRIER_FIELD_KEYS } from '@/lib/member-profile'
import type { MemberProfile, TeamMemberProfile } from '@/types/member-profile'

export function profileFromSaveResponse(result: {
  data?: { source?: string; data?: unknown }
}): MemberProfile | null {
  const row = result.data?.data
  return row && typeof row === 'object' && 'user_id' in row ? (row as MemberProfile) : null
}

export function teamMemberProfileFromSaveResponse(result: {
  data?: { source?: string; data?: unknown }
}): TeamMemberProfile | null {
  if (result.data?.source !== 'team_member_profile') return null
  const row = result.data?.data
  return row &&
    typeof row === 'object' &&
    'id' in row &&
    'created_by_user_id' in row &&
    'organization_id' in row
    ? (row as TeamMemberProfile)
    : null
}

export function resolveRefreshedOwnProfile(
  userId: string,
  savedProfile: MemberProfile | null | undefined,
  refreshedProfile: MemberProfile | null | undefined,
  error: { message?: string } | null
): MemberProfile {
  if (savedProfile?.user_id === userId) {
    return savedProfile
  }

  if (error) {
    throw new Error(error.message || 'Failed to refresh profile after save.')
  }

  if (!refreshedProfile) {
    throw new Error('Profile not found after save.')
  }

  return refreshedProfile
}

/** Prefer API-returned carrier columns when a post-save refresh is stale. */
export function mergeCarrierFieldsOntoProfile(
  profile: MemberProfile,
  savedProfile: MemberProfile | null | undefined
): MemberProfile {
  if (!savedProfile?.user_id || savedProfile.user_id !== profile.user_id) {
    return profile
  }

  const merged: MemberProfile = { ...profile }
  for (const key of CARRIER_FIELD_KEYS) {
    if (key in savedProfile) {
      merged[key] = savedProfile[key]
    }
  }
  return merged
}