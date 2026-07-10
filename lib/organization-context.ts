'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { canUseServiceMode, filterServiceModeCarriers } from '@/lib/service-mode-scope'
import type { AccessibleCarrier, Organization, WorkspaceMode } from '@/types/organization'

export const WORKSPACE_MODE_STORAGE_KEY = 'truckeros_workspace_mode'
export const ACTIVE_ORGANIZATION_STORAGE_KEY = 'truckeros_active_organization_id'

export function getWorkspaceMode(): WorkspaceMode {
  if (typeof window === 'undefined') return 'carrier'
  const stored = window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY)
  return stored === 'service' ? 'service' : 'carrier'
}

export function setWorkspaceMode(mode: WorkspaceMode): void {
  if (typeof window === 'undefined') return
  // Skip no-op writes so multi-hook instances don't re-broadcast the same mode.
  if (getWorkspaceMode() === mode) return
  window.localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, mode)
  window.dispatchEvent(new CustomEvent('truckeros:workspace-mode', { detail: mode }))
}

export function getActiveOrganizationId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY)
}

export function setActiveOrganizationId(organizationId: string | null): void {
  if (typeof window === 'undefined') return
  // Skip no-op writes so multi-hook instances don't re-broadcast the same org.
  if (getActiveOrganizationId() === organizationId) return
  if (organizationId) {
    window.localStorage.setItem(ACTIVE_ORGANIZATION_STORAGE_KEY, organizationId)
  } else {
    window.localStorage.removeItem(ACTIVE_ORGANIZATION_STORAGE_KEY)
  }
  window.dispatchEvent(
    new CustomEvent('truckeros:active-organization', { detail: organizationId })
  )
}

export function canAccessOrg(
  organizationId: string,
  accessibleOrganizationIds: readonly string[]
): boolean {
  return accessibleOrganizationIds.includes(organizationId)
}

export function organizationDisplayName(org: Pick<Organization, 'name' | 'usdot_number'> | null | undefined): string {
  const name = org?.name?.trim()
  if (name) return name
  const usdot = org?.usdot_number?.trim()
  if (usdot) return `USDOT ${usdot}`
  return 'Unnamed carrier'
}

export function resolveEffectiveOrganizationId(options: {
  workspaceMode: WorkspaceMode
  ownOrganizationId?: string | null
  activeOrganizationId?: string | null
  accessibleOrganizationIds?: readonly string[]
}): string | null {
  const { workspaceMode, ownOrganizationId, activeOrganizationId, accessibleOrganizationIds = [] } = options

  if (workspaceMode === 'carrier') {
    return ownOrganizationId ?? null
  }

  if (activeOrganizationId && canAccessOrg(activeOrganizationId, accessibleOrganizationIds)) {
    return activeOrganizationId
  }

  return null
}

/**
 * Desired active organization while in service mode (after carriers have loaded).
 * Keeps a valid selection; otherwise falls back to the first eligible carrier (or null).
 * firstEligibleCarrierId is ignored unless it appears in accessibleOrganizationIds.
 */
export function resolveServiceModeActiveOrganizationId(options: {
  activeOrganizationId?: string | null
  accessibleOrganizationIds?: readonly string[]
  firstEligibleCarrierId?: string | null
}): string | null {
  const {
    activeOrganizationId = null,
    accessibleOrganizationIds = [],
    firstEligibleCarrierId = null,
  } = options

  if (activeOrganizationId && canAccessOrg(activeOrganizationId, accessibleOrganizationIds)) {
    return activeOrganizationId
  }

  if (
    firstEligibleCarrierId &&
    canAccessOrg(firstEligibleCarrierId, accessibleOrganizationIds)
  ) {
    return firstEligibleCarrierId
  }

  return null
}

export type ServiceModeSelectionDecision =
  | { action: 'none' }
  | { action: 'set'; organizationId: string | null }

/**
 * Pure effect decision for service-mode auto-select / stale-clear.
 * Contract: only returns `set` when the active org must change; callers must not
 * call setActiveOrganization when action is `none` (loop / multi-instance safety).
 *
 * Policy (multi-instance safe):
 * - null active + non-empty list → auto-select firstEligible (if in list)
 * - active in list → keep (none)
 * - active non-null, not in list, list empty after definitive load → clear
 * - active non-null, not in list, list non-empty → keep (none); trust peer/storage
 *   until this instance’s list catches up or becomes empty (never firstEligible over
 *   a non-null active from a fresher mount)
 * - no updates while loading or before carriers loaded for a signed-in user
 */
export function decideServiceModeActiveOrganizationUpdate(options: {
  workspaceMode: WorkspaceMode
  loading: boolean
  /** True only after carriers were fetched for a signed-in user. */
  carriersLoadedForUser: boolean
  activeOrganizationId?: string | null
  accessibleOrganizationIds?: readonly string[]
  firstEligibleCarrierId?: string | null
}): ServiceModeSelectionDecision {
  const {
    workspaceMode,
    loading,
    carriersLoadedForUser,
    activeOrganizationId = null,
    accessibleOrganizationIds = [],
    firstEligibleCarrierId = null,
  } = options

  if (workspaceMode !== 'service' || loading || !carriersLoadedForUser) {
    return { action: 'none' }
  }

  // Definitive empty list after user load: clear non-null active only.
  if (accessibleOrganizationIds.length === 0) {
    if (activeOrganizationId == null) return { action: 'none' }
    return { action: 'set', organizationId: null }
  }

  // Active in this instance’s list → keep.
  if (activeOrganizationId && canAccessOrg(activeOrganizationId, accessibleOrganizationIds)) {
    return { action: 'none' }
  }

  // Active non-null but missing from a (possibly stale) non-empty list → keep.
  // Do not replace with firstEligible (would clobber peer/storage fresher selection).
  if (activeOrganizationId) {
    return { action: 'none' }
  }

  // null active + non-empty list → auto-select first eligible when valid.
  const nextId = resolveServiceModeActiveOrganizationId({
    activeOrganizationId: null,
    accessibleOrganizationIds,
    firstEligibleCarrierId,
  })
  if (nextId == null) return { action: 'none' }
  return { action: 'set', organizationId: nextId }
}

/** Shallow equality for carrier list refresh bailouts (id + eligibility fields). */
export function areAccessibleCarrierListsEqual(
  prev: readonly AccessibleCarrier[],
  next: readonly AccessibleCarrier[]
): boolean {
  if (prev === next) return true
  if (prev.length !== next.length) return false
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i]
    const b = next[i]
    if (
      a.id !== b.id ||
      a.access_source !== b.access_source ||
      a.membership_role !== b.membership_role
    ) {
      return false
    }
  }
  return true
}

export function parseAccessibleOrganizationIdsKey(key: string): string[] {
  if (!key) return []
  return key.split('\0').filter(Boolean)
}

export function toAccessibleOrganizationIdsKey(ids: readonly string[]): string {
  return ids.join('\0')
}

function dedupeCarriers(rows: AccessibleCarrier[]): AccessibleCarrier[] {
  const byId = new Map<string, AccessibleCarrier>()
  for (const row of rows) {
    const existing = byId.get(row.id)
    if (!existing) {
      byId.set(row.id, row)
      continue
    }
    if (existing.access_source !== 'primary_owner' && row.access_source === 'primary_owner') {
      byId.set(row.id, row)
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    organizationDisplayName(a).localeCompare(organizationDisplayName(b), undefined, {
      sensitivity: 'base',
    })
  )
}

export async function fetchAccessibleCarriers(userId: string): Promise<AccessibleCarrier[]> {
  const supabase = createClient()
  const carriers: AccessibleCarrier[] = []

  const [{ data: memberships }, { data: createdOrgs }] = await Promise.all([
    supabase
      .from('organization_memberships')
      .select('role, is_primary_owner, organization:organizations(*)')
      .eq('user_id', userId),
    supabase.from('organizations').select('*').eq('created_by_user_id', userId),
  ])

  if (memberships) {
    for (const row of memberships as Array<{
      role: string
      is_primary_owner: boolean
      organization: Organization | null
    }>) {
      if (!row.organization?.id) continue
      carriers.push({
        ...row.organization,
        access_source: row.is_primary_owner ? 'primary_owner' : 'membership',
        membership_role: row.role,
      })
    }
  }

  if (createdOrgs) {
    for (const org of createdOrgs as Organization[]) {
      if (!org.id) continue
      if (carriers.some((c) => c.id === org.id)) continue
      carriers.push({
        ...org,
        access_source: 'created',
        membership_role: 'Owner',
      })
    }
  }

  return dedupeCarriers(carriers)
}

export type OrganizationContextValue = {
  workspaceMode: WorkspaceMode
  setWorkspaceMode: (mode: WorkspaceMode) => void
  activeOrganizationId: string | null
  setActiveOrganization: (organizationId: string | null) => void
  accessibleCarriers: AccessibleCarrier[]
  activeOrganization: AccessibleCarrier | null
  effectiveOrganizationId: string | null
  ownOrganizationId: string | null
  canEnterServiceMode: boolean
  loading: boolean
  refreshCarriers: () => Promise<void>
}

export function useOrganizationContext(ownOrganizationId?: string | null): OrganizationContextValue {
  const [workspaceMode, setWorkspaceModeState] = useState<WorkspaceMode>('carrier')
  const [activeOrganizationId, setActiveOrganizationIdState] = useState<string | null>(null)
  const [accessibleCarriers, setAccessibleCarriers] = useState<AccessibleCarrier[]>([])
  const [loading, setLoading] = useState(true)
  /** Set only after a carriers fetch completed for a signed-in user (not no-session). */
  const [carriersLoadedForUser, setCarriersLoadedForUser] = useState(false)

  const refreshCarriers = useCallback(async () => {
    const supabase = createClient()
    const { data: sessionData } = await supabase.auth.getSession()
    const userId = sessionData.session?.user?.id
    if (!userId) {
      setAccessibleCarriers((prev) => (areAccessibleCarrierListsEqual(prev, []) ? prev : []))
      // No session: do not claim a definitive user load (avoids multi-instance eject).
      setCarriersLoadedForUser(false)
      return
    }
    const carriers = await fetchAccessibleCarriers(userId)
    setAccessibleCarriers((prev) => (areAccessibleCarrierListsEqual(prev, carriers) ? prev : carriers))
    setCarriersLoadedForUser(true)
  }, [])

  useEffect(() => {
    setWorkspaceModeState(getWorkspaceMode())
    setActiveOrganizationIdState(getActiveOrganizationId())

    const onModeChange = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceMode>).detail
      if (detail === 'carrier' || detail === 'service') {
        setWorkspaceModeState((prev) => (prev === detail ? prev : detail))
      }
    }

    const onOrgChange = (event: Event) => {
      const detail = (event as CustomEvent<string | null>).detail ?? null
      setActiveOrganizationIdState((prev) => (prev === detail ? prev : detail))
    }

    window.addEventListener('truckeros:workspace-mode', onModeChange)
    window.addEventListener('truckeros:active-organization', onOrgChange)

    return () => {
      window.removeEventListener('truckeros:workspace-mode', onModeChange)
      window.removeEventListener('truckeros:active-organization', onOrgChange)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    refreshCarriers().finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [refreshCarriers])

  const serviceModeCarriers = useMemo(
    () => filterServiceModeCarriers(accessibleCarriers),
    [accessibleCarriers]
  )

  const canEnterServiceMode = useMemo(
    () => canUseServiceMode(accessibleCarriers),
    [accessibleCarriers]
  )

  const applyWorkspaceMode = useCallback(
    (mode: WorkspaceMode) => {
      if (mode === 'service' && !canEnterServiceMode) {
        return
      }
      // Already in requested mode: skip storage events and carrier-mode org clear.
      if (mode === workspaceMode) {
        return
      }
      setWorkspaceModeState(mode)
      setWorkspaceMode(mode)
      if (mode === 'carrier') {
        setActiveOrganizationIdState((prev) => (prev === null ? prev : null))
        setActiveOrganizationId(null)
      }
    },
    [canEnterServiceMode, workspaceMode]
  )

  const setActiveOrganization = useCallback((organizationId: string | null) => {
    setActiveOrganizationIdState((prev) => (prev === organizationId ? prev : organizationId))
    setActiveOrganizationId(organizationId)
  }, [])

  const accessibleOrganizationIds = useMemo(
    () => serviceModeCarriers.map((carrier) => carrier.id),
    [serviceModeCarriers]
  )

  // Primitive key — auto-select effect depends on this, not array identity.
  const accessibleOrganizationIdsKey = useMemo(
    () => toAccessibleOrganizationIdsKey(accessibleOrganizationIds),
    [accessibleOrganizationIds]
  )

  const firstEligibleCarrierId = serviceModeCarriers[0]?.id ?? null

  const activeOrganization = useMemo(() => {
    if (!activeOrganizationId) return null
    return serviceModeCarriers.find((carrier) => carrier.id === activeOrganizationId) ?? null
  }, [activeOrganizationId, serviceModeCarriers])

  const effectiveOrganizationId = useMemo(
    () =>
      resolveEffectiveOrganizationId({
        workspaceMode,
        ownOrganizationId,
        activeOrganizationId,
        accessibleOrganizationIds,
      }),
    [workspaceMode, ownOrganizationId, activeOrganizationId, accessibleOrganizationIds]
  )

  // Clear stale selection; auto-select first carrier when entering service mode.
  // Decision is pure (decideServiceModeActiveOrganizationUpdate); only set when action === 'set'.
  useEffect(() => {
    const accessibleIds = parseAccessibleOrganizationIdsKey(accessibleOrganizationIdsKey)
    const decision = decideServiceModeActiveOrganizationUpdate({
      workspaceMode,
      loading,
      carriersLoadedForUser,
      activeOrganizationId,
      accessibleOrganizationIds: accessibleIds,
      firstEligibleCarrierId,
    })

    if (decision.action === 'none') return
    setActiveOrganization(decision.organizationId)
  }, [
    workspaceMode,
    loading,
    carriersLoadedForUser,
    activeOrganizationId,
    accessibleOrganizationIdsKey,
    firstEligibleCarrierId,
    setActiveOrganization,
  ])

  // Revert persisted service mode only after a successful load for a signed-in user
  // (avoids empty/no-session mounts ejecting eligible peers still in service mode).
  useEffect(() => {
    if (loading || !carriersLoadedForUser) return
    if (workspaceMode !== 'service' || canEnterServiceMode) return
    applyWorkspaceMode('carrier')
  }, [loading, carriersLoadedForUser, workspaceMode, canEnterServiceMode, applyWorkspaceMode])

  return {
    workspaceMode,
    setWorkspaceMode: applyWorkspaceMode,
    activeOrganizationId,
    setActiveOrganization,
    accessibleCarriers,
    activeOrganization,
    effectiveOrganizationId,
    ownOrganizationId: ownOrganizationId ?? null,
    canEnterServiceMode,
    loading,
    refreshCarriers,
  }
}