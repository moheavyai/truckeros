import type { EquipmentScope } from '@/lib/service-mode-scope'

/** Organization to stamp on new/updated tractor and trailer rows in carrier mode. */
export function equipmentOrganizationIdForSave(
  ownOrganizationId: string | null | undefined
): string | null {
  const trimmed = (ownOrganizationId ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Supabase PostgREST `.or()` filter for equipment_profiles loads.
 * Includes org-scoped rows plus legacy user-owned rows saved before organization_id was set.
 */
export function equipmentProfilesLoadOrFilter(
  organizationId: string,
  ownerUserId: string
): string {
  return `organization_id.eq.${organizationId},and(organization_id.is.null,user_id.eq.${ownerUserId})`
}

export function shouldUseOrganizationEquipmentFilter(scope: EquipmentScope): boolean {
  return !!scope.organizationId
}