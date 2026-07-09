import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  ACTIVE_ORGANIZATION_STORAGE_KEY,
  WORKSPACE_MODE_STORAGE_KEY,
  areAccessibleCarrierListsEqual,
  canAccessOrg,
  decideServiceModeActiveOrganizationUpdate,
  getActiveOrganizationId,
  getWorkspaceMode,
  organizationDisplayName,
  parseAccessibleOrganizationIdsKey,
  resolveEffectiveOrganizationId,
  resolveServiceModeActiveOrganizationId,
  setActiveOrganizationId,
  setWorkspaceMode,
  toAccessibleOrganizationIdsKey,
} from './organization-context'
import type { AccessibleCarrier } from '@/types/organization'

function carrier(id: string, role = 'Permit Clerk'): AccessibleCarrier {
  return {
    id,
    name: id,
    access_source: 'membership',
    membership_role: role,
  }
}

describe('organization-context storage helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null
      },
      setItem(key: string, value: string) {
        this.store[key] = value
      },
      removeItem(key: string) {
        delete this.store[key]
      },
    })
    vi.stubGlobal('window', {
      localStorage: (globalThis as { localStorage: Storage }).localStorage,
      dispatchEvent: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults workspace mode to carrier', () => {
    expect(getWorkspaceMode()).toBe('carrier')
  })

  it('persists service workspace mode', () => {
    setWorkspaceMode('service')
    expect(localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY)).toBe('service')
    expect(getWorkspaceMode()).toBe('service')
  })

  it('persists and clears active organization id', () => {
    setActiveOrganizationId('org-123')
    expect(getActiveOrganizationId()).toBe('org-123')
    setActiveOrganizationId(null)
    expect(getActiveOrganizationId()).toBeNull()
  })

  it('does not re-dispatch when workspace mode is unchanged', () => {
    setWorkspaceMode('service')
    const dispatch = window.dispatchEvent as ReturnType<typeof vi.fn>
    dispatch.mockClear()
    setWorkspaceMode('service')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not re-dispatch when active organization is unchanged', () => {
    setActiveOrganizationId('org-123')
    const dispatch = window.dispatchEvent as ReturnType<typeof vi.fn>
    dispatch.mockClear()
    setActiveOrganizationId('org-123')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not re-dispatch when clearing already-null active organization', () => {
    const dispatch = window.dispatchEvent as ReturnType<typeof vi.fn>
    dispatch.mockClear()
    setActiveOrganizationId(null)
    expect(dispatch).not.toHaveBeenCalled()
    expect(getActiveOrganizationId()).toBeNull()
  })

  it('dispatches once on positive path when organization id changes', () => {
    const dispatch = window.dispatchEvent as ReturnType<typeof vi.fn>
    dispatch.mockClear()
    setActiveOrganizationId('org-a')
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY)).toBe('org-a')
    dispatch.mockClear()
    setActiveOrganizationId('org-b')
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(getActiveOrganizationId()).toBe('org-b')
  })
})

describe('organization-context resolution', () => {
  it('checks org access against accessible id list', () => {
    expect(canAccessOrg('org-1', ['org-1', 'org-2'])).toBe(true)
    expect(canAccessOrg('org-3', ['org-1', 'org-2'])).toBe(false)
  })

  it('uses own organization in carrier mode', () => {
    expect(
      resolveEffectiveOrganizationId({
        workspaceMode: 'carrier',
        ownOrganizationId: 'org-own',
        activeOrganizationId: 'org-other',
        accessibleOrganizationIds: ['org-own', 'org-other'],
      })
    ).toBe('org-own')
  })

  it('uses active organization in service mode when accessible', () => {
    expect(
      resolveEffectiveOrganizationId({
        workspaceMode: 'service',
        ownOrganizationId: 'org-own',
        activeOrganizationId: 'org-other',
        accessibleOrganizationIds: ['org-own', 'org-other'],
      })
    ).toBe('org-other')
  })

  it('returns null in service mode without a valid active selection', () => {
    expect(
      resolveEffectiveOrganizationId({
        workspaceMode: 'service',
        ownOrganizationId: 'org-own',
        activeOrganizationId: 'org-missing',
        accessibleOrganizationIds: ['org-own'],
      })
    ).toBeNull()
  })

  it('formats organization display names', () => {
    expect(organizationDisplayName({ name: 'Acme Hauling', usdot_number: '123' })).toBe('Acme Hauling')
    expect(organizationDisplayName({ name: '', usdot_number: '123' })).toBe('USDOT 123')
    expect(organizationDisplayName(null)).toBe('Unnamed carrier')
  })
})

describe('service mode active organization resolution', () => {
  it('keeps a valid active selection (stable — no update needed)', () => {
    expect(
      resolveServiceModeActiveOrganizationId({
        activeOrganizationId: 'org-2',
        accessibleOrganizationIds: ['org-1', 'org-2'],
        firstEligibleCarrierId: 'org-1',
      })
    ).toBe('org-2')
  })

  it('auto-selects first eligible carrier when none selected', () => {
    expect(
      resolveServiceModeActiveOrganizationId({
        activeOrganizationId: null,
        accessibleOrganizationIds: ['org-1', 'org-2'],
        firstEligibleCarrierId: 'org-1',
      })
    ).toBe('org-1')
  })

  it('replaces stale selection with first eligible carrier', () => {
    expect(
      resolveServiceModeActiveOrganizationId({
        activeOrganizationId: 'org-missing',
        accessibleOrganizationIds: ['org-1', 'org-2'],
        firstEligibleCarrierId: 'org-1',
      })
    ).toBe('org-1')
  })

  it('clears stale selection when no eligible carriers remain', () => {
    expect(
      resolveServiceModeActiveOrganizationId({
        activeOrganizationId: 'org-missing',
        accessibleOrganizationIds: [],
        firstEligibleCarrierId: null,
      })
    ).toBeNull()
  })

  it('stays null when nothing is selected and no carriers exist', () => {
    expect(
      resolveServiceModeActiveOrganizationId({
        activeOrganizationId: null,
        accessibleOrganizationIds: [],
        firstEligibleCarrierId: null,
      })
    ).toBeNull()
  })

  it('ignores firstEligibleCarrierId not present in accessible ids', () => {
    expect(
      resolveServiceModeActiveOrganizationId({
        activeOrganizationId: null,
        accessibleOrganizationIds: ['org-1'],
        firstEligibleCarrierId: 'org-rogue',
      })
    ).toBeNull()
  })

  it('returns null when firstEligible is null even if accessible ids exist', () => {
    // Call contract: firstEligible should be accessibleOrganizationIds[0]; if null, no fallback.
    expect(
      resolveServiceModeActiveOrganizationId({
        activeOrganizationId: 'org-missing',
        accessibleOrganizationIds: ['org-1'],
        firstEligibleCarrierId: null,
      })
    ).toBeNull()
  })
})

describe('decideServiceModeActiveOrganizationUpdate (effect contract)', () => {
  const base = {
    workspaceMode: 'service' as const,
    loading: false,
    carriersLoadedForUser: true,
    accessibleOrganizationIds: ['org-1', 'org-2'],
    firstEligibleCarrierId: 'org-1',
  }

  it('returns none when a valid selection is already active (no setActiveOrganization)', () => {
    expect(
      decideServiceModeActiveOrganizationUpdate({
        ...base,
        activeOrganizationId: 'org-2',
      })
    ).toEqual({ action: 'none' })
  })

  it('returns none when resolving the same id list again (loop regression)', () => {
    const first = decideServiceModeActiveOrganizationUpdate({
      ...base,
      activeOrganizationId: null,
    })
    expect(first).toEqual({ action: 'set', organizationId: 'org-1' })

    // After applying first decision, re-running with same list must not update again.
    const second = decideServiceModeActiveOrganizationUpdate({
      ...base,
      activeOrganizationId: 'org-1',
    })
    expect(second).toEqual({ action: 'none' })
  })

  it('does not clobber selection when accessible list is empty and not loaded for user', () => {
    expect(
      decideServiceModeActiveOrganizationUpdate({
        workspaceMode: 'service',
        loading: false,
        carriersLoadedForUser: false,
        activeOrganizationId: 'org-from-peer',
        accessibleOrganizationIds: [],
        firstEligibleCarrierId: null,
      })
    ).toEqual({ action: 'none' })
  })

  it('does not clobber while still loading even with empty list', () => {
    expect(
      decideServiceModeActiveOrganizationUpdate({
        workspaceMode: 'service',
        loading: true,
        carriersLoadedForUser: false,
        activeOrganizationId: 'org-from-peer',
        accessibleOrganizationIds: [],
        firstEligibleCarrierId: null,
      })
    ).toEqual({ action: 'none' })
  })

  it('clears selection only after definitive empty load for signed-in user', () => {
    expect(
      decideServiceModeActiveOrganizationUpdate({
        workspaceMode: 'service',
        loading: false,
        carriersLoadedForUser: true,
        activeOrganizationId: 'org-stale',
        accessibleOrganizationIds: [],
        firstEligibleCarrierId: null,
      })
    ).toEqual({ action: 'set', organizationId: null })
  })

  it('returns none for null→null after empty definitive load', () => {
    expect(
      decideServiceModeActiveOrganizationUpdate({
        workspaceMode: 'service',
        loading: false,
        carriersLoadedForUser: true,
        activeOrganizationId: null,
        accessibleOrganizationIds: [],
        firstEligibleCarrierId: null,
      })
    ).toEqual({ action: 'none' })
  })

  it('auto-selects first eligible after load when nothing selected', () => {
    expect(
      decideServiceModeActiveOrganizationUpdate({
        ...base,
        activeOrganizationId: null,
      })
    ).toEqual({ action: 'set', organizationId: 'org-1' })
  })

  it('keeps peer-fresh active not in local non-empty list (no firstEligible clobber)', () => {
    // Header still has [org-1] while carriers page selected org-new → must not replace.
    expect(
      decideServiceModeActiveOrganizationUpdate({
        ...base,
        activeOrganizationId: 'org-new',
        accessibleOrganizationIds: ['org-1'],
        firstEligibleCarrierId: 'org-1',
      })
    ).toEqual({ action: 'none' })
  })

  it('keeps active missing from non-empty list (stale list, not definitive empty)', () => {
    expect(
      decideServiceModeActiveOrganizationUpdate({
        ...base,
        activeOrganizationId: 'org-missing',
      })
    ).toEqual({ action: 'none' })
  })

  it('returns none in carrier mode', () => {
    expect(
      decideServiceModeActiveOrganizationUpdate({
        ...base,
        workspaceMode: 'carrier',
        activeOrganizationId: null,
      })
    ).toEqual({ action: 'none' })
  })
})

describe('accessible organization id keys', () => {
  it('round-trips ids through key without array identity', () => {
    const ids = ['org-1', 'org-2']
    const key = toAccessibleOrganizationIdsKey(ids)
    expect(key).toBe('org-1\0org-2')
    expect(parseAccessibleOrganizationIdsKey(key)).toEqual(ids)
    expect(parseAccessibleOrganizationIdsKey('')).toEqual([])
  })
})

describe('areAccessibleCarrierListsEqual', () => {
  it('returns true for same ids and eligibility fields', () => {
    expect(areAccessibleCarrierListsEqual([carrier('a')], [carrier('a')])).toBe(true)
  })

  it('returns false when ids differ', () => {
    expect(areAccessibleCarrierListsEqual([carrier('a')], [carrier('b')])).toBe(false)
  })

  it('returns false when membership role differs', () => {
    expect(
      areAccessibleCarrierListsEqual([carrier('a', 'Viewer')], [carrier('a', 'Permit Clerk')])
    ).toBe(false)
  })
})
