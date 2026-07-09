import { describe, expect, it } from 'vitest'
import {
  resolveActingActor,
  resolveActingRolesFromInputs,
  resolveNavActor,
  resolveNavOrganizationId,
} from './nav-actor'

describe('resolveNavOrganizationId', () => {
  it('uses active org in service mode', () => {
    expect(
      resolveNavOrganizationId({
        profileOrgId: 'org-home',
        workspaceMode: 'service',
        activeOrganizationId: 'org-active',
        preferredMembershipOrgId: 'org-pref',
      })
    ).toBe('org-active')
  })

  it('uses profile home in carrier mode', () => {
    expect(
      resolveNavOrganizationId({
        profileOrgId: 'org-home',
        workspaceMode: 'carrier',
        activeOrganizationId: 'org-active',
      })
    ).toBe('org-home')
  })
})

describe('resolveActingRolesFromInputs', () => {
  it('home Owner Operator: primary owner + Owner+Driver → merge home roles', () => {
    const acting = resolveActingRolesFromInputs({
      membershipRole: 'Owner',
      membershipIsPrimaryOwner: true,
      homeOrgId: 'org-home',
      homeIsPrimaryOwner: true,
      homeUserRoles: ['Owner', 'Driver'],
      effectiveOrgId: 'org-home',
    })
    expect(acting.membershipRole).toBe('Owner')
    expect(acting.user_roles).toEqual(['Owner', 'Driver'])
    expect(acting.is_primary_owner).toBe(true)
    expect(acting.isOwnerOperator).toBe(true)
  })

  it('home non-primary: membership role only (no home multi-select override)', () => {
    const acting = resolveActingRolesFromInputs({
      membershipRole: 'Driver',
      membershipIsPrimaryOwner: false,
      homeOrgId: 'org-home',
      homeIsPrimaryOwner: false,
      // Malicious / stale multi-select must not elevate a non-primary home member.
      homeUserRoles: ['Owner', 'Driver'],
      effectiveOrgId: 'org-home',
    })
    expect(acting.membershipRole).toBe('Driver')
    expect(acting.user_roles).toEqual(['Driver'])
    expect(acting.is_primary_owner).toBe(false)
    expect(acting.isOwnerOperator).toBe(false)
  })

  it('service mode foreign org: never merge home Owner Operator', () => {
    const acting = resolveActingRolesFromInputs({
      membershipRole: 'Permit Clerk',
      membershipIsPrimaryOwner: false,
      homeOrgId: 'org-home',
      homeIsPrimaryOwner: true,
      homeUserRoles: ['Owner', 'Driver'],
      effectiveOrgId: 'org-client',
    })
    expect(acting.membershipRole).toBe('Permit Clerk')
    expect(acting.user_roles).toEqual(['Permit Clerk'])
    expect(acting.is_primary_owner).toBe(false)
    expect(acting.isOwnerOperator).toBe(false)
  })

  it('service mode home edge: OO merge still applies when effective org is home', () => {
    const acting = resolveActingRolesFromInputs({
      membershipRole: 'Owner',
      membershipIsPrimaryOwner: true,
      homeOrgId: 'org-home',
      homeIsPrimaryOwner: true,
      homeUserRoles: ['Owner', 'Driver'],
      effectiveOrgId: 'org-home',
    })
    expect(acting.user_roles).toEqual(['Owner', 'Driver'])
    expect(acting.isOwnerOperator).toBe(true)
  })

  it('home primary owner Owner-only (not OO): membership role only', () => {
    const acting = resolveActingRolesFromInputs({
      membershipRole: 'Owner',
      membershipIsPrimaryOwner: true,
      homeOrgId: 'org-home',
      homeIsPrimaryOwner: true,
      homeUserRoles: ['Owner'],
      effectiveOrgId: 'org-home',
    })
    expect(acting.user_roles).toEqual(['Owner'])
    expect(acting.isOwnerOperator).toBe(false)
  })

  it('falls back to home roles on home org when membership missing', () => {
    const acting = resolveActingRolesFromInputs({
      membershipRole: null,
      // membershipIsPrimaryOwner omitted → bootstrap path uses home primary
      homeOrgId: 'org-home',
      homeIsPrimaryOwner: true,
      homeUserRoles: ['Admin'],
      effectiveOrgId: 'org-home',
    })
    expect(acting.membershipRole).toBeNull()
    expect(acting.user_roles).toEqual(['Admin'])
    expect(acting.is_primary_owner).toBe(true)
    expect(acting.isOwnerOperator).toBe(false)
  })

  it('prefers membership is_primary_owner=false over stale home primary (no OO merge)', () => {
    const acting = resolveActingRolesFromInputs({
      membershipRole: 'Admin',
      membershipIsPrimaryOwner: false,
      homeOrgId: 'org-home',
      homeIsPrimaryOwner: true,
      homeUserRoles: ['Owner', 'Driver'],
      effectiveOrgId: 'org-home',
    })
    expect(acting.is_primary_owner).toBe(false)
    expect(acting.user_roles).toEqual(['Admin'])
    expect(acting.isOwnerOperator).toBe(false)
  })

  it('empty roles when off home org and no membership', () => {
    const acting = resolveActingRolesFromInputs({
      membershipRole: null,
      homeOrgId: 'org-home',
      homeUserRoles: ['Owner', 'Driver'],
      effectiveOrgId: 'org-other',
    })
    expect(acting.user_roles).toEqual([])
    expect(acting.isOwnerOperator).toBe(false)
  })
})

describe('resolveActingActor', () => {
  it('wires membership + home profile for home OO', () => {
    const acting = resolveActingActor({
      profile: {
        organization_id: 'org-home',
        user_roles: ['Owner', 'Driver'],
        is_primary_owner: true,
      },
      memberships: [
        {
          organization_id: 'org-home',
          role: 'Owner',
          is_primary_owner: true,
        },
      ],
      workspaceMode: 'carrier',
    })
    expect(acting.organizationId).toBe('org-home')
    expect(acting.user_roles).toEqual(['Owner', 'Driver'])
    expect(acting.isOwnerOperator).toBe(true)
  })

  it('service mode foreign org ignores home OO', () => {
    const acting = resolveActingActor({
      profile: {
        organization_id: 'org-home',
        user_roles: ['Owner', 'Driver'],
        is_primary_owner: true,
      },
      memberships: [
        {
          organization_id: 'org-home',
          role: 'Owner',
          is_primary_owner: true,
        },
        {
          organization_id: 'org-client',
          role: 'Permit Clerk',
          is_primary_owner: false,
        },
      ],
      workspaceMode: 'service',
      activeOrganizationId: 'org-client',
    })
    expect(acting.organizationId).toBe('org-client')
    expect(acting.user_roles).toEqual(['Permit Clerk'])
    expect(acting.isOwnerOperator).toBe(false)
  })
})

describe('resolveNavActor', () => {
  it('applies membership permissions for preferred org', () => {
    const actor = resolveNavActor({
      profile: {
        organization_id: 'org-1',
        user_roles: ['Driver'],
        is_primary_owner: false,
      },
      memberships: [
        {
          organization_id: 'org-1',
          role: 'Driver',
          permissions: { mode: 'custom', custom: { equipment: true, profiles: false } },
        },
      ],
    })
    expect(actor.permissions.mode).toBe('custom')
    expect(actor.permissions.custom?.equipment).toBe(true)
    expect(actor.membershipRole).toBe('Driver')
    expect(actor.isOwnerOperator).toBe(false)
  })

  it('derives roles from membership when profile has no org', () => {
    const actor = resolveNavActor({
      profile: { organization_id: null, user_roles: [], is_primary_owner: false },
      memberships: [
        {
          organization_id: 'org-clerk',
          role: 'Permit Clerk',
          is_primary_owner: false,
          permissions: { mode: 'global' },
        },
      ],
    })
    expect(actor.user_roles).toContain('Permit Clerk')
    expect(actor.organizationId).toBe('org-clerk')
  })

  it('uses service-mode active membership role for multi-org clerks', () => {
    const actor = resolveNavActor({
      profile: {
        organization_id: 'org-home',
        user_roles: ['Owner'],
        is_primary_owner: true,
      },
      memberships: [
        {
          organization_id: 'org-home',
          role: 'Owner',
          is_primary_owner: true,
          permissions: { mode: 'global' },
        },
        {
          organization_id: 'org-client',
          role: 'Permit Clerk',
          is_primary_owner: false,
          permissions: { mode: 'custom', custom: { equipment: true } },
        },
      ],
      workspaceMode: 'service',
      activeOrganizationId: 'org-client',
    })
    expect(actor.user_roles).toContain('Permit Clerk')
    expect(actor.is_primary_owner).toBe(false)
    expect(actor.organizationId).toBe('org-client')
    expect(actor.isOwnerOperator).toBe(false)
  })

  it('prefers primary-owner membership when no profile org', () => {
    const actor = resolveNavActor({
      profile: null,
      memberships: [
        {
          organization_id: 'org-new',
          role: 'Driver',
          is_primary_owner: false,
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          organization_id: 'org-home',
          role: 'Owner',
          is_primary_owner: true,
          created_at: '2020-01-01T00:00:00Z',
        },
      ],
    })
    expect(actor.organizationId).toBe('org-home')
    expect(actor.user_roles).toContain('Owner')
  })

  it('home OO retains Driver capabilities via acting SSoT', () => {
    const actor = resolveNavActor({
      profile: {
        organization_id: 'org-home',
        user_roles: ['Owner', 'Driver'],
        is_primary_owner: true,
      },
      memberships: [
        {
          organization_id: 'org-home',
          role: 'Owner',
          is_primary_owner: true,
          permissions: { mode: 'global' },
        },
      ],
      workspaceMode: 'carrier',
    })
    expect(actor.user_roles).toEqual(['Owner', 'Driver'])
    expect(actor.membershipRole).toBe('Owner')
    expect(actor.isOwnerOperator).toBe(true)
  })

  it('service mode foreign org drops home OO even when profile has Owner+Driver', () => {
    const actor = resolveNavActor({
      profile: {
        organization_id: 'org-home',
        user_roles: ['Owner', 'Driver'],
        is_primary_owner: true,
      },
      memberships: [
        {
          organization_id: 'org-home',
          role: 'Owner',
          is_primary_owner: true,
        },
        {
          organization_id: 'org-client',
          role: 'Admin',
          is_primary_owner: false,
        },
      ],
      workspaceMode: 'service',
      activeOrganizationId: 'org-client',
    })
    expect(actor.user_roles).toEqual(['Admin'])
    expect(actor.isOwnerOperator).toBe(false)
  })
})
