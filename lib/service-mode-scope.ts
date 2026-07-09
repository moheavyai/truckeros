/**
 * Service Mode eligibility + equipment/permit org scoping.
 * Glossary: docs/plans/glossary-accounts-roles.md
 * Plan: docs/plans/user-accounts-roles-flows.md (Phase 1: Permit Clerk only)
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccessibleCarrier } from '@/types/organization'
import type { WorkspaceMode } from '@/types/organization'
import { organizationDisplayName } from '@/lib/organization-context'

/** Phase 1: Service Mode is Permit Clerk membership only (no Owner/Admin / primary_owner bypass). */
export const SERVICE_MODE_ELIGIBLE_ROLES = ['Permit Clerk'] as const

export type EquipmentScope = {
  /** Filter equipment_profiles by organization when set. */
  organizationId: string | null
  /** Primary owner user id for rig_configurations — never clerk ownUserId in service mode. */
  rigOwnerUserId: string | null
  canLoadEquipment: boolean
  canLoadRigs: boolean
}

export type PrimaryOwnerLookupResult = {
  userId: string | null
  error: string | null
}

/**
 * Resolves which organization scopes permit/driver/equipment loads.
 * Carrier mode uses the signed-in user's org; service mode uses the header-selected carrier.
 */
export function resolvePermitOrganizationId(options: {
  workspaceMode: WorkspaceMode
  ownOrganizationId?: string | null
  effectiveOrganizationId?: string | null
}): string | null {
  const { workspaceMode, ownOrganizationId, effectiveOrganizationId } = options
  if (workspaceMode === 'service') return effectiveOrganizationId ?? null
  return ownOrganizationId ?? null
}

/** Carriers the user may scope in Service Mode (Permit Clerk membership only). */
export function filterServiceModeCarriers(
  carriers: readonly AccessibleCarrier[]
): AccessibleCarrier[] {
  return carriers.filter(isServiceModeEligibleCarrier)
}

/** Whether the user may switch to service mode (Permit Clerk on at least one carrier). */
export function canUseServiceMode(carriers: readonly AccessibleCarrier[]): boolean {
  return filterServiceModeCarriers(carriers).length > 0
}

/**
 * Phase 1: role-only eligibility. No access_source primary_owner/created short-circuit.
 * Phase 3 will also require service_seat.
 */
export function isServiceModeEligibleCarrier(carrier: AccessibleCarrier): boolean {
  const role = carrier.membership_role?.trim()
  return (
    role != null &&
    (SERVICE_MODE_ELIGIBLE_ROLES as readonly string[]).includes(role)
  )
}

/** Primary owner's auth user id for a carrier org (rig_configurations are user-scoped). */
export async function fetchCarrierPrimaryOwnerUserId(
  supabase: SupabaseClient,
  organizationId: string
): Promise<PrimaryOwnerLookupResult> {
  const { data, error } = await supabase
    .from('member_profiles')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('is_primary_owner', true)
    .maybeSingle()

  if (error) {
    console.warn('[service-mode] fetchCarrierPrimaryOwnerUserId failed:', error)
    return { userId: null, error: error.message || 'Failed to resolve carrier primary owner' }
  }

  if (!data?.user_id) {
    return { userId: null, error: 'No primary owner found for this carrier organization' }
  }

  return { userId: data.user_id, error: null }
}

export function resolveEquipmentScope(options: {
  workspaceMode: WorkspaceMode
  ownUserId: string
  ownOrganizationId?: string | null
  effectiveOrganizationId?: string | null
  carrierPrimaryOwnerUserId?: string | null
}): EquipmentScope {
  const {
    workspaceMode,
    ownUserId,
    ownOrganizationId,
    effectiveOrganizationId,
    carrierPrimaryOwnerUserId,
  } = options

  if (workspaceMode === 'service') {
    if (!effectiveOrganizationId) {
      return {
        organizationId: null,
        rigOwnerUserId: null,
        canLoadEquipment: false,
        canLoadRigs: false,
      }
    }

    const rigOwnerUserId = carrierPrimaryOwnerUserId ?? null
    return {
      organizationId: effectiveOrganizationId,
      rigOwnerUserId,
      canLoadEquipment: true,
      canLoadRigs: rigOwnerUserId != null,
    }
  }

  return {
    organizationId: ownOrganizationId ?? null,
    rigOwnerUserId: ownUserId,
    canLoadEquipment: true,
    canLoadRigs: true,
  }
}

export function filterAccessibleCarriers(
  carriers: readonly AccessibleCarrier[],
  query: string
): AccessibleCarrier[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return [...carriers]

  return carriers.filter((carrier) => {
    const name = organizationDisplayName(carrier).toLowerCase()
    const usdot = carrier.usdot_number?.trim().toLowerCase() ?? ''
    const mc = carrier.mc_number?.trim().toLowerCase() ?? ''
    const role = carrier.membership_role?.trim().toLowerCase() ?? ''
    return (
      name.includes(normalized) ||
      usdot.includes(normalized) ||
      mc.includes(normalized) ||
      role.includes(normalized)
    )
  })
}

export function carrierSummaryLabel(carrier: AccessibleCarrier): string {
  const parts = [organizationDisplayName(carrier)]
  if (carrier.usdot_number?.trim()) parts.push(`USDOT ${carrier.usdot_number.trim()}`)
  if (carrier.membership_role?.trim()) parts.push(carrier.membership_role.trim())
  return parts.join(' · ')
}