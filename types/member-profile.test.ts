import { describe, expect, it } from 'vitest'
import { ASSIGNABLE_TEAM_ROLES, USER_ROLE_OPTIONS } from './member-profile'

describe('member-profile types', () => {
  it('exports five user role options without Dispatcher', () => {
    expect(USER_ROLE_OPTIONS).toHaveLength(5)
    expect(USER_ROLE_OPTIONS).not.toContain('Dispatcher')
    expect(USER_ROLE_OPTIONS).toContain('Owner')
    expect(USER_ROLE_OPTIONS).toContain('Admin')
    expect(USER_ROLE_OPTIONS).toContain('Permit Clerk')
  })

  it('excludes Owner from assignable team roles', () => {
    expect(ASSIGNABLE_TEAM_ROLES).not.toContain('Owner')
    expect(ASSIGNABLE_TEAM_ROLES).toContain('Admin')
    expect(ASSIGNABLE_TEAM_ROLES).toHaveLength(4)
  })
})