import fs from 'fs'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { MemberProfileFormData } from '@/types/member-profile'

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index < 0) continue
    const key = line.slice(0, index).trim()
    const value = line
      .slice(index + 1)
      .trim()
      .replace(/\s+#.*$/, '')
    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadEnvLocal()

const LIVE = process.env.LIVE_BOOTSTRAP === '1'

describe.skipIf(!LIVE)('saveTeamMemberProfileForUser live Owner bootstrap', () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  const testEmail = `owner-bootstrap-${Date.now()}@truckeros.test`
  const testPassword = `BootstrapTest!${Date.now()}`
  let userId = ''
  let accessToken = ''
  let organizationId = ''
  let saveTeamMemberProfileForUser: typeof import('./team-member-profiles-api').saveTeamMemberProfileForUser
  let emptyMemberProfileForm: () => MemberProfileFormData

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  beforeAll(async () => {
    const api = await import('./team-member-profiles-api')
    const profile = await import('./member-profile')
    saveTeamMemberProfileForUser = api.saveTeamMemberProfileForUser
    emptyMemberProfileForm = profile.emptyMemberProfileForm

    const { data, error } = await admin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })
    if (error || !data.user) {
      throw new Error(error?.message ?? 'Failed to create test user')
    }
    userId = data.user.id

    const authed = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    })
    const { data: signInData, error: signInError } = await authed.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    })
    if (signInError || !signInData.session?.access_token) {
      throw new Error(signInError?.message ?? 'Failed to sign in test user')
    }
    accessToken = signInData.session.access_token
  })

  afterAll(async () => {
    if (organizationId) {
      await admin.from('organization_memberships').delete().eq('organization_id', organizationId)
      await admin.from('member_profiles').delete().eq('organization_id', organizationId)
      await admin.from('organizations').delete().eq('id', organizationId)
    } else if (userId) {
      await admin.from('member_profiles').delete().eq('user_id', userId)
    }
    if (userId) {
      await admin.auth.admin.deleteUser(userId)
    }
  })

  it('saves initial Owner profile without foreign key violation', async () => {
    const companyName = 'Live Bootstrap Carrier LLC'
    const result = await saveTeamMemberProfileForUser(accessToken, {
      form: {
        ...emptyMemberProfileForm(),
        company_name: companyName,
        driver_full_name: 'Live Test Owner',
        driver_email: testEmail,
        carrier_phone: '555-0100',
        driver_phone: '555-0101',
        user_roles: ['Owner', 'Driver'],
      },
      saveScope: 'full',
    })

    const saved = result.data as {
      organization_id?: string
      is_primary_owner?: boolean
      company_name?: string
      user_roles?: string[]
    }

    expect(saved.organization_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    organizationId = saved.organization_id!
    expect(saved.is_primary_owner).toBe(true)
    expect(saved.company_name).toBe(companyName)
    expect(saved.user_roles).toEqual(['Owner', 'Driver'])

    const { data: orgRow, error: orgError } = await admin
      .from('organizations')
      .select('id, name, created_by_user_id')
      .eq('id', organizationId)
      .single()
    expect(orgError).toBeNull()
    expect(orgRow?.name).toBe(companyName)
    expect(orgRow?.created_by_user_id).toBe(userId)

    const { data: membershipRow, error: membershipError } = await admin
      .from('organization_memberships')
      .select('organization_id, user_id, is_primary_owner, role')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .single()
    expect(membershipError).toBeNull()
    expect(membershipRow?.is_primary_owner).toBe(true)
    expect(membershipRow?.role).toBe('Owner')
  })
})