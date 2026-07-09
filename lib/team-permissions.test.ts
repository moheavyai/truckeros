import { describe, expect, it } from 'vitest'
import {
  canAccessArea,
  canActorDeleteMember,
  canActorRequestMemberDeletion,
  canDeleteResource,
  emptyMemberPermissionConfig,
  hasOwnerOrAdminRole,
  requiresDeletionApproval,
  resolveEffectivePermissions,
  ROLE_DEFAULT_PERMISSIONS,
} from './team-permissions'

describe('ROLE_DEFAULT_PERMISSIONS', () => {
  it('grants full write to Owner and Admin', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.Owner.equipment).toBe('write')
    expect(ROLE_DEFAULT_PERMISSIONS.Admin.profiles).toBe('write')
  })

  it('restricts Driver to permit/portal/file areas only', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.Driver.equipment).toBe('none')
    expect(ROLE_DEFAULT_PERMISSIONS.Driver.profiles).toBe('none')
    expect(ROLE_DEFAULT_PERMISSIONS.Driver.permit_agent).toBe('write')
    expect(ROLE_DEFAULT_PERMISSIONS.Driver.portal_agent).toBe('write')
    expect(ROLE_DEFAULT_PERMISSIONS.Driver.file_upload).toBe('write')
  })

  it('gives Permit Clerk write on carriers/equipment/drivers areas', () => {
    expect(ROLE_DEFAULT_PERMISSIONS['Permit Clerk'].equipment).toBe('write')
    expect(ROLE_DEFAULT_PERMISSIONS['Permit Clerk'].profiles).toBe('write')
    expect(ROLE_DEFAULT_PERMISSIONS['Permit Clerk'].account_settings).toBe('none')
  })

  it('makes Viewer read-only', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.Viewer.equipment).toBe('read')
    expect(ROLE_DEFAULT_PERMISSIONS.Viewer.profiles).toBe('read')
  })
})

describe('resolveEffectivePermissions', () => {
  it('applies custom toggles over role defaults', () => {
    const effective = resolveEffectivePermissions({
      user_roles: ['Admin'],
      permissions: {
        mode: 'custom',
        custom: { equipment: true, profiles: false, account_settings: false },
      },
    })

    expect(effective.equipment).toBe('write')
    expect(effective.profiles).toBe('none')
    expect(effective.account_settings).toBe('none')
  })

  it('inherits role defaults in global mode', () => {
    const effective = resolveEffectivePermissions({
      user_roles: ['Viewer'],
      permissions: emptyMemberPermissionConfig(),
    })

    expect(canAccessArea('equipment', effective)).toBe(true)
    expect(canAccessArea('equipment', effective, { requireWrite: true })).toBe(false)
  })

  it('merges Owner and Driver role defaults for Owner Operator accounts', () => {
    const effective = resolveEffectivePermissions({
      user_roles: ['Owner', 'Driver'],
      is_primary_owner: true,
    })

    expect(effective.equipment).toBe('write')
    expect(effective.profiles).toBe('write')
    expect(effective.permit_agent).toBe('write')
    expect(effective.portal_agent).toBe('write')
    expect(effective.file_upload).toBe('write')
  })
})

describe('canActorDeleteMember', () => {
  it('prevents Admin from deleting Owner role holders', () => {
    expect(
      canActorDeleteMember(
        { user_roles: ['Admin'], is_primary_owner: false },
        { user_roles: ['Owner'], is_primary_owner: true, is_self: false }
      )
    ).toBe(false)
  })

  it('allows Owner to delete Admin members', () => {
    expect(
      canActorDeleteMember(
        { user_roles: ['Owner'], is_primary_owner: true },
        { user_roles: ['Admin'], is_primary_owner: false, is_self: false }
      )
    ).toBe(true)
  })

  it('prevents self-delete', () => {
    expect(
      canActorDeleteMember(
        { user_roles: ['Owner'], is_primary_owner: true },
        { user_roles: ['Owner'], is_primary_owner: true, is_self: true }
      )
    ).toBe(false)
  })
})

describe('hasOwnerOrAdminRole', () => {
  it('returns false for null actor', () => {
    expect(hasOwnerOrAdminRole(null)).toBe(false)
    expect(hasOwnerOrAdminRole(undefined)).toBe(false)
  })
})

describe('canActorRequestMemberDeletion', () => {
  it('allows permit clerks to request team member removal', () => {
    expect(
      canActorRequestMemberDeletion(
        { user_roles: ['Permit Clerk'] },
        { user_roles: ['Driver'], is_primary_owner: false, is_self: false },
        'team_member'
      )
    ).toBe(true)
  })
})

describe('deletion approval helpers', () => {
  it('requires approval for Permit Clerk deletes', () => {
    expect(
      requiresDeletionApproval({ user_roles: ['Permit Clerk'] }, 'equipment')
    ).toBe(true)
  })

  it('allows Owner direct deletes', () => {
    expect(requiresDeletionApproval({ user_roles: ['Owner'] }, 'equipment')).toBe(false)
    expect(canDeleteResource('Owner', 'equipment', { user_roles: ['Driver'] })).toBe(true)
  })
})