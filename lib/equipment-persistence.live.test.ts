import fs from 'fs'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { equipmentProfilesLoadOrFilter } from './equipment-persistence'

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index < 0) continue
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim().replace(/\s+#.*$/, '')
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvLocal()

const LIVE = process.env.LIVE_EQUIPMENT === '1'

describe.skipIf(!LIVE)('equipment persistence live', () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  const testEmail = `equipment-live-${Date.now()}@truckeros.test`
  const testPassword = `EquipTest!${Date.now()}`
  let userId = ''
  let organizationId = ''
  let accessToken = ''
  const createdEquipmentIds: string[] = []
  let createdRigId = ''

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })
    if (error || !data.user) throw new Error(error?.message ?? 'createUser failed')
    userId = data.user.id

    const authed = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
    const { data: signIn, error: signInErr } = await authed.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    })
    if (signInErr || !signIn.session?.access_token) throw new Error(signInErr?.message ?? 'signIn failed')
    accessToken = signIn.session.access_token

    organizationId = crypto.randomUUID()
    await admin.from('organizations').insert({
      id: organizationId,
      name: 'Equipment Test Carrier',
      created_by_user_id: userId,
    })
    await admin.from('member_profiles').insert({
      user_id: userId,
      organization_id: organizationId,
      is_primary_owner: true,
      user_roles: ['Owner'],
      company_name: 'Equipment Test Carrier',
      driver_full_name: 'Equip Tester',
      driver_email: testEmail,
    })
    await admin.from('organization_memberships').insert({
      organization_id: organizationId,
      user_id: userId,
      role: 'Owner',
      is_primary_owner: true,
      permissions: { mode: 'global' },
    })
  })

  afterAll(async () => {
    if (createdRigId) {
      await admin.from('rig_configurations').delete().eq('id', createdRigId)
    }
    for (const id of createdEquipmentIds) {
      await admin.from('equipment_profiles').delete().eq('id', id)
    }
    if (organizationId) {
      await admin.from('organization_memberships').delete().eq('organization_id', organizationId)
      await admin.from('member_profiles').delete().eq('organization_id', organizationId)
      await admin.from('organizations').delete().eq('id', organizationId)
    }
    if (userId) await admin.auth.admin.deleteUser(userId)
  })

  it('does not return null-organization tractor rows under org-only filter', async () => {
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    })

    const structured = { _v: 1, type: 'tractor', overall_length_ft: 28, num_axles: 3, _notes: '' }
    const { data: orphanRow, error: orphanErr } = await client
      .from('equipment_profiles')
      .insert({
        user_id: userId,
        type: 'tractor',
        name: 'Orphan Org Tractor',
        profile_name: 'Orphan Org Tractor',
        axles: 3,
        notes: `RIGBUILDER:v1:${JSON.stringify(structured)}`,
      })
      .select('id')
      .single()

    expect(orphanErr).toBeNull()
    createdEquipmentIds.push(orphanRow!.id)

    const { data: orgOnly } = await client
      .from('equipment_profiles')
      .select('id')
      .eq('organization_id', organizationId)

    expect(orgOnly?.some((row) => row.id === orphanRow!.id)).toBe(false)
  })

  it('saves and reloads tractor, trailer, and rig by organization scope', async () => {
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    })

    const tractorStructured = {
      _v: 1,
      type: 'tractor',
      overall_length_ft: 28,
      num_axles: 3,
      steer_axle_setback_in: 36,
      wheelbase_in: 220,
      axle_spacings: [220, 48],
      fifth_wheel_from_rear_in: 24,
      _notes: '',
    }

    const { data: tractorRow, error: tractorErr } = await client
      .from('equipment_profiles')
      .insert({
        user_id: userId,
        organization_id: organizationId,
        type: 'tractor',
        name: 'Live Test Tractor',
        profile_name: 'Live Test Tractor',
        axles: 3,
        axle_spacing: ['220', '48'],
        notes: `RIGBUILDER:v1:${JSON.stringify(tractorStructured)}`,
      })
      .select('id')
      .single()

    expect(tractorErr).toBeNull()
    createdEquipmentIds.push(tractorRow!.id)

    const trailerStructured = {
      _v: 1,
      type: 'trailer',
      overall_length_ft: 53,
      kingpin_distance_from_front_in: 36,
      num_axles: 2,
      axle_spacings: [49],
      kingpin_to_first_axle_in: 480,
      has_lift_axle: false,
      is_extendable: false,
      extendable_extra_ft: 0,
      trailer_type: 'Flatbed',
      _notes: '',
    }

    const { data: trailerRow, error: trailerErr } = await client
      .from('equipment_profiles')
      .insert({
        user_id: userId,
        organization_id: organizationId,
        type: 'trailer',
        name: 'Live Test Trailer',
        profile_name: 'Live Test Trailer',
        length_ft: 53,
        axles: 2,
        axle_spacing: ['49'],
        notes: `RIGBUILDER:v1:${JSON.stringify(trailerStructured)}`,
      })
      .select('id')
      .single()

    expect(trailerErr).toBeNull()
    createdEquipmentIds.push(trailerRow!.id)

    const { data: rigRow, error: rigErr } = await client
      .from('rig_configurations')
      .insert({
        user_id: userId,
        name: 'Live Test Rig',
        rig_name: 'Live Test Rig',
        tractor_id: tractorRow!.id,
        trailer_ids: [trailerRow!.id],
        computed_total_length_ft: 81,
        computed_total_axles: 5,
        computed_kingpin_to_last_axle_ft: 45,
      })
      .select('id')
      .single()

    expect(rigErr).toBeNull()
    createdRigId = rigRow!.id

    const { data: orgEquipment, error: loadErr } = await client
      .from('equipment_profiles')
      .select('id, profile_name, organization_id, notes')
      .or(equipmentProfilesLoadOrFilter(organizationId, userId))

    expect(loadErr).toBeNull()
    const decoded = (orgEquipment ?? []).filter((row) =>
      String(row.notes ?? '').startsWith('RIGBUILDER:v1:')
    )
    expect(decoded.some((r) => r.profile_name === 'Live Test Tractor')).toBe(true)
    expect(decoded.some((r) => r.profile_name === 'Live Test Trailer')).toBe(true)

    const { data: rigs, error: rigLoadErr } = await client
      .from('rig_configurations')
      .select('id, rig_name, name')
      .eq('user_id', userId)

    expect(rigLoadErr).toBeNull()
    expect(rigs?.some((r) => r.id === createdRigId)).toBe(true)
  })
})