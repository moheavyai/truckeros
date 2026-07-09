import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CarrierLinkRequest,
  CreateLinkRequestInput,
  LinkRequestStatus,
  Organization,
} from '@/types/organization'

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeUsdot(value: string | null | undefined): string | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null
  return trimmed.replace(/^USDOT[-\s]*/i, '').trim() || null
}

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = trimOrNull(value)
  return trimmed ? trimmed.toLowerCase() : null
}

export function validateCreateLinkRequestInput(input: CreateLinkRequestInput): {
  target_usdot: string | null
  target_email: string | null
  message: string | null
} {
  const target_usdot = normalizeUsdot(input.target_usdot)
  const target_email = normalizeEmail(input.target_email)
  const message = trimOrNull(input.message)

  if (!target_usdot && !target_email) {
    throw new Error('Provide a USDOT number or company email to request access')
  }

  return { target_usdot, target_email, message }
}

export async function resolveOrganizationForLinkRequest(
  supabase: SupabaseClient,
  input: { target_usdot: string | null; target_email: string | null }
): Promise<Organization | null> {
  if (input.target_usdot) {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('usdot_number', input.target_usdot)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (data) return data as Organization
  }

  if (input.target_email) {
    const { data, error } = await supabase
      .from('member_profiles')
      .select('organization_id, company_name, usdot_number, mc_number, carrier_email')
      .ilike('carrier_email', input.target_email)
      .not('organization_id', 'is', null)
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message)

    if (data?.organization_id) {
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', data.organization_id)
        .maybeSingle()

      if (orgError) throw new Error(orgError.message)
      if (org) return org as Organization

      return {
        id: data.organization_id,
        name: data.company_name,
        usdot_number: data.usdot_number,
        mc_number: data.mc_number,
      }
    }
  }

  return null
}

export async function createCarrierLinkRequest(
  supabase: SupabaseClient,
  fromUserId: string,
  input: CreateLinkRequestInput
): Promise<CarrierLinkRequest> {
  const normalized = validateCreateLinkRequestInput(input)
  const organization = await resolveOrganizationForLinkRequest(supabase, normalized)

  const payload = {
    from_user_id: fromUserId,
    to_organization_id: organization?.id ?? null,
    target_usdot: normalized.target_usdot,
    target_email: normalized.target_email,
    message: normalized.message,
    status: 'pending' as LinkRequestStatus,
  }

  const { data, error } = await supabase
    .from('carrier_link_requests')
    .insert(payload)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data as CarrierLinkRequest
}

export async function listOutgoingLinkRequests(
  supabase: SupabaseClient,
  fromUserId: string
): Promise<CarrierLinkRequest[]> {
  const { data, error } = await supabase
    .from('carrier_link_requests')
    .select('*, organization:organizations(*)')
    .eq('from_user_id', fromUserId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as CarrierLinkRequest[]
}

export async function listIncomingLinkRequestsForOwner(
  supabase: SupabaseClient,
  organizationId: string
): Promise<CarrierLinkRequest[]> {
  const { data, error } = await supabase
    .from('carrier_link_requests')
    .select('*')
    .eq('to_organization_id', organizationId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as CarrierLinkRequest[]
  if (rows.length === 0) return rows

  const requesterIds = [...new Set(rows.map((row) => row.from_user_id))]
  const { data: requesterProfiles, error: profileError } = await supabase
    .from('member_profiles')
    .select('user_id, driver_full_name, driver_email, carrier_email')
    .in('user_id', requesterIds)

  if (profileError) throw new Error(profileError.message)

  const profileByUserId = new Map(
    (requesterProfiles ?? []).map((profile) => [profile.user_id as string, profile])
  )

  return rows.map((row) => {
    const profile = profileByUserId.get(row.from_user_id)
    const name = (profile?.driver_full_name as string | undefined)?.trim()
    const email =
      (profile?.driver_email as string | undefined)?.trim() ||
      (profile?.carrier_email as string | undefined)?.trim() ||
      null
    return {
      ...row,
      requester_name: name || email || 'Account link request',
      requester_email: email,
    }
  })
}

async function ensureMembershipForApprovedRequest(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string
): Promise<void> {
  const { data: existing, error: existingError } = await supabase
    .from('organization_memberships')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle()

  if (existingError) throw new Error(existingError.message)
  if (existing) return

  // Phase 1: approve grants Viewer only (not Permit Clerk) — closes SM regain via link request.
  const { error } = await supabase.from('organization_memberships').insert({
    organization_id: organizationId,
    user_id: userId,
    role: 'Viewer',
    is_primary_owner: false,
    permissions: { mode: 'global' },
  })

  if (error) throw new Error(error.message)
}

export async function respondToCarrierLinkRequest(
  supabase: SupabaseClient,
  requestId: string,
  responderUserId: string,
  action: 'approve' | 'reject'
): Promise<CarrierLinkRequest> {
  const { data: existing, error: fetchError } = await supabase
    .from('carrier_link_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle()

  if (fetchError) throw new Error(fetchError.message)
  if (!existing) throw new Error('Link request not found')
  if (existing.status !== 'pending') throw new Error('Link request has already been responded to')

  let organizationId = existing.to_organization_id as string | null

  if (action === 'approve' && !organizationId) {
    const resolved = await resolveOrganizationForLinkRequest(supabase, {
      target_usdot: existing.target_usdot,
      target_email: existing.target_email,
    })
    organizationId = resolved?.id ?? null
    if (!organizationId) {
      throw new Error('Could not resolve carrier organization for this request')
    }
  }

  const status: LinkRequestStatus = action === 'approve' ? 'approved' : 'rejected'
  const updatePayload: Record<string, unknown> = {
    status,
    responded_at: new Date().toISOString(),
    responded_by_user_id: responderUserId,
  }

  if (organizationId && !existing.to_organization_id) {
    updatePayload.to_organization_id = organizationId
  }

  const { data, error } = await supabase
    .from('carrier_link_requests')
    .update(updatePayload)
    .eq('id', requestId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)

  if (action === 'approve' && organizationId) {
    await ensureMembershipForApprovedRequest(
      supabase,
      organizationId,
      existing.from_user_id as string
    )
  }

  return data as CarrierLinkRequest
}