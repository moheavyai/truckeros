export type WorkspaceMode = 'carrier' | 'service'

export type LinkRequestStatus = 'pending' | 'approved' | 'rejected'

export type OrganizationRole = 'Owner' | 'Admin' | 'Driver' | 'Permit Clerk' | 'Viewer'

export type Organization = {
  id: string
  name?: string | null
  usdot_number?: string | null
  mc_number?: string | null
  created_by_user_id?: string | null
  created_at?: string
}

export type OrganizationMembership = {
  id: string
  organization_id: string
  user_id: string
  role: OrganizationRole | string
  permissions?: string[] | Record<string, unknown>
  is_primary_owner?: boolean
  created_at?: string
  organization?: Organization | null
}

export type CarrierLinkRequest = {
  id: string
  from_user_id: string
  to_organization_id?: string | null
  target_usdot?: string | null
  target_email?: string | null
  status: LinkRequestStatus
  message?: string | null
  created_at?: string
  responded_at?: string | null
  responded_by_user_id?: string | null
  organization?: Organization | null
  requester_name?: string | null
  requester_email?: string | null
}

export type AccessibleCarrier = Organization & {
  access_source: 'membership' | 'created' | 'primary_owner'
  membership_role?: string | null
}

export type CreateLinkRequestInput = {
  target_usdot?: string
  target_email?: string
  message?: string
}

export type CarrierConnectionInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export type CarrierConnectionInvite = {
  id: string
  invited_by_user_id: string
  organization_id?: string | null
  company_name: string
  usdot_number?: string | null
  mc_number?: string | null
  ein?: string | null
  carrier_address?: string | null
  carrier_phone?: string | null
  carrier_email?: string | null
  insurance_contact?: string | null
  invite_contact_name?: string | null
  /** Required for Owner-granting connection invites (email-bound accept). */
  invite_email: string
  invite_phone?: string | null
  invite_token: string
  invite_link?: string | null
  status: CarrierConnectionInviteStatus
  accepted_by_user_id?: string | null
  accepted_at?: string | null
  expires_at: string
  message?: string | null
  created_at?: string
}

export type CreateCarrierConnectionInviteInput = {
  company_name?: string
  usdot_number?: string
  mc_number?: string
  ein?: string
  carrier_address?: string
  carrier_phone?: string
  carrier_email?: string
  insurance_contact?: string
  invite_contact_name?: string
  invite_email?: string
  invite_phone?: string
  message?: string
}