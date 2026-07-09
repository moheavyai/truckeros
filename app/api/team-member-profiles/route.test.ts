import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

function readRouteSource() {
  return readFileSync(
    path.join(process.cwd(), 'app', 'api', 'team-member-profiles', 'route.ts'),
    'utf8'
  )
}

function readApiSource() {
  return readFileSync(path.join(process.cwd(), 'lib', 'team-member-profiles-api.ts'), 'utf8')
}

describe('/api/team-member-profiles errorStatus', () => {
  it('maps self-promote PE messages to 403', () => {
    const source = readRouteSource()
    expect(source).toContain('cannot reassign your own membership')
    expect(source).toContain('return 403')
  })

  it('maps role/org validation messages to 400', () => {
    const source = readRouteSource()
    expect(source).toContain('only admin, driver, permit clerk')
    expect(source).toContain('at least one role is required')
    expect(source).toContain('organization not configured')
    expect(source).toContain('return 400')
  })
})

describe('/api/team-member-profiles roster child under carrier', () => {
  it('routes team_member_profile saves to roster create/update only', () => {
    const source = readRouteSource()
    expect(source).toContain("source === 'team_member_profile'")
    expect(source).toContain('createOrUpdateRosterMemberForUser')
    expect(source).toContain('saveTeamMemberProfileForUser')
  })

  it('roster path never bootstraps organizations or primary owner', () => {
    const api = readApiSource()
    const rosterStart = api.indexOf('export async function createOrUpdateRosterMemberForUser')
    const rosterEnd = api.indexOf('export async function deleteTeamMemberForUser')
    expect(rosterStart).toBeGreaterThan(-1)
    expect(rosterEnd).toBeGreaterThan(rosterStart)
    const rosterFn = api.slice(rosterStart, rosterEnd)

    expect(rosterFn).toContain('buildTeamMemberChildRosterPayload')
    expect(rosterFn).toContain('resolveCarrierInheritanceSource')
    expect(rosterFn).not.toContain('ensureOrganizationRecord')
    expect(rosterFn).not.toContain('ensureOrganizationBootstrap')
    expect(rosterFn).not.toContain('prepareMemberProfileSave')
    expect(rosterFn).not.toContain('generateOrganizationId')
    expect(rosterFn).not.toContain('is_primary_owner = true')
    expect(rosterFn).not.toContain('is_primary_owner: true')
  })

  it('other-member path loads target, preserves primary, updates in-org only', () => {
    const api = readApiSource()
    const otherStart = api.indexOf("if (!actorProfile?.organization_id)")
    // Find the other-member branch after self-return
    const saveFn = api.slice(
      api.indexOf('export async function saveTeamMemberProfileForUser'),
      api.indexOf('export async function createOrUpdateRosterMemberForUser')
    )
    const otherBranch = saveFn.slice(saveFn.lastIndexOf('if (!actorProfile?.organization_id)'))

    expect(otherBranch).toContain('assertAssignableTeamMemberRoles')
    expect(otherBranch).toContain('Team member not found')
    expect(otherBranch).toContain('targetIsPrimary')
    expect(otherBranch).toContain('payload.is_primary_owner = targetIsPrimary')
    expect(otherBranch).toMatch(/\.update\(payload\)/)
    expect(otherBranch).toContain(".eq('organization_id', organizationId)")
    expect(otherBranch).not.toContain('.upsert(payload')
  })
})
