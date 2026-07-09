'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import {
  canCreateCarrierConnectionInvite,
  filterActivePendingCarrierConnectionInvites,
} from '@/lib/carrier-connection-invites'
import {
  organizationDisplayName,
  setActiveOrganizationId,
  useOrganizationContext,
} from '@/lib/organization-context'
import { createClient } from '@/lib/supabase/client'
import type { MemberProfile } from '@/types/member-profile'
import type {
  AccessibleCarrier,
  CarrierConnectionInvite,
  CarrierLinkRequest,
} from '@/types/organization'

const inputClass =
  'border border-gray-300 px-3 py-2 rounded-lg w-full text-sm focus:outline-none focus:ring-2 focus:ring-black/10'

const emptyAddCarrierForm = {
  company_name: '',
  usdot_number: '',
  mc_number: '',
  ein: '',
  carrier_address: '',
  carrier_phone: '',
  carrier_email: '',
  insurance_contact: '',
  invite_contact_name: '',
  invite_email: '',
  invite_phone: '',
  message: '',
}

export default function CarriersPage() {
  const router = useRouter()
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [ownProfile, setOwnProfile] = useState<MemberProfile | null>(null)
  const [membershipRoles, setMembershipRoles] = useState<string[]>([])
  const [authLoading, setAuthLoading] = useState(true)
  const [requestUsdot, setRequestUsdot] = useState('')
  const [requestEmail, setRequestEmail] = useState('')
  const [requestMessage, setRequestMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [addingCarrier, setAddingCarrier] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [addForm, setAddForm] = useState(emptyAddCarrierForm)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  )
  const [outgoingRequests, setOutgoingRequests] = useState<CarrierLinkRequest[]>([])
  const [connectionInvites, setConnectionInvites] = useState<CarrierConnectionInvite[]>([])
  const [invitesListError, setInvitesListError] = useState<string | null>(null)
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null)

  const {
    accessibleCarriers,
    activeOrganizationId,
    refreshCarriers,
    workspaceMode,
    loading: contextLoading,
  } = useOrganizationContext(ownProfile?.organization_id)

  const canAddCarrier = useMemo(
    () => canCreateCarrierConnectionInvite(ownProfile, membershipRoles),
    [ownProfile, membershipRoles]
  )

  const loadOutgoingRequests = useCallback(async (accessToken: string) => {
    const response = await fetch('/api/carrier-link-requests?direction=outgoing', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const result = await response.json()
    if (response.ok && result.success) {
      setOutgoingRequests(result.data ?? [])
    }
  }, [])

  const loadConnectionInvites = useCallback(async (accessToken: string) => {
    setInvitesListError(null)
    try {
      const response = await fetch('/api/carrier-connection-invites', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        setInvitesListError(result.error || 'Failed to load connection invites')
        return
      }
      setConnectionInvites(result.data ?? [])
    } catch {
      setInvitesListError('Failed to load connection invites')
    }
  }, [])

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.push('/login')
        return
      }

      setUser(session.user)

      const [{ data: profile }, { data: memberships }] = await Promise.all([
        supabase
          .from('member_profiles')
          .select('*')
          .eq('user_id', session.user.id)
          .maybeSingle(),
        supabase
          .from('organization_memberships')
          .select('role')
          .eq('user_id', session.user.id),
      ])

      if (profile) {
        setOwnProfile(profile as MemberProfile)
      }
      setMembershipRoles(
        (memberships ?? [])
          .map((row) => String((row as { role?: string }).role ?? '').trim())
          .filter(Boolean)
      )

      if (session.access_token) {
        await loadOutgoingRequests(session.access_token)
        await loadConnectionInvites(session.access_token)
      }

      setAuthLoading(false)
    })
  }, [router, loadOutgoingRequests, loadConnectionInvites])

  useEffect(() => {
    if (!authLoading && !contextLoading && workspaceMode !== 'service') {
      router.replace('/dashboard')
    }
  }, [authLoading, contextLoading, workspaceMode, router])

  const handleSelectCarrier = (carrier: AccessibleCarrier) => {
    setActiveOrganizationId(carrier.id)
    setFeedback({ type: 'success', text: `Selected ${organizationDisplayName(carrier)}.` })
  }

  const handleRequestAccess = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setFeedback(null)
    setLastInviteLink(null)

    try {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Session expired. Please sign in again.')

      const response = await fetch('/api/carrier-link-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          target_usdot: requestUsdot,
          target_email: requestEmail,
          message: requestMessage,
        }),
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to send link request')
      }

      setRequestUsdot('')
      setRequestEmail('')
      setRequestMessage('')
      setFeedback({
        type: 'success',
        text: 'Account link request sent. The carrier owner can approve it from their profile.',
      })
      await loadOutgoingRequests(accessToken)
      await refreshCarriers()
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to send link request',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleAddCarrier = async (event: React.FormEvent) => {
    event.preventDefault()
    setFeedback(null)
    setLastInviteLink(null)

    if (!addForm.company_name.trim()) {
      setFeedback({ type: 'error', text: 'Company name is required.' })
      return
    }
    if (!addForm.invite_email.trim()) {
      setFeedback({
        type: 'error',
        text: 'Invite email is required so the carrier owner can accept securely.',
      })
      return
    }

    setAddingCarrier(true)

    try {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Session expired. Please sign in again.')

      const response = await fetch('/api/carrier-connection-invites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(addForm),
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to add carrier and send invite')
      }

      const invite = result.data as CarrierConnectionInvite
      const link =
        (invite.invite_link as string | undefined) ||
        (result.email?.invite_link as string | undefined) ||
        null

      setAddForm(emptyAddCarrierForm)
      setLastInviteLink(link)

      const deliveryNote =
        result.email?.stubbed || result.sms?.stubbed || !result.email?.sent
          ? ' Invite delivery is stubbed in this environment — share the invite link below.'
          : ' Invite sent to the carrier owner.'

      setFeedback({
        type: 'success',
        text: `Carrier “${invite.company_name}” saved and connection invite created.${deliveryNote}`,
      })

      await loadConnectionInvites(accessToken)
      await refreshCarriers()

      if (invite.organization_id) {
        setActiveOrganizationId(invite.organization_id)
      }
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to add carrier',
      })
    } finally {
      setAddingCarrier(false)
    }
  }

  const handleRevokeInvite = async (inviteId: string) => {
    if (!window.confirm('Revoke this connection invite? The shareable link will stop working.')) {
      return
    }
    setFeedback(null)
    setRevokingId(inviteId)
    try {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Session expired. Please sign in again.')

      const response = await fetch('/api/carrier-connection-invites', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ id: inviteId }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to revoke invite')
      }
      setFeedback({ type: 'success', text: 'Connection invite revoked.' })
      await loadConnectionInvites(accessToken)
      await refreshCarriers()
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to revoke invite',
      })
    } finally {
      setRevokingId(null)
    }
  }

  const handleCopyInviteLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link)
      setFeedback({ type: 'success', text: 'Invite link copied to clipboard.' })
    } catch {
      setFeedback({ type: 'error', text: 'Could not copy link. Select and copy it manually.' })
    }
  }

  // Avoid flashing the full carriers UI for non-service-mode users.
  if (authLoading || contextLoading || workspaceMode !== 'service') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-700 font-medium">Loading carriers…</p>
      </div>
    )
  }

  const pendingConnectionInvites = filterActivePendingCarrierConnectionInvites(
    connectionInvites
  )

  const feedbackBanner = feedback ? (
    <div
      role="status"
      className={`mb-6 rounded-xl px-4 py-3 text-sm ${
        feedback.type === 'success'
          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          : 'bg-red-50 text-red-800 border border-red-200'
      }`}
    >
      {feedback.text}
    </div>
  ) : null

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader user={user} activePage="carriers" ownOrganizationId={ownProfile?.organization_id} />

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Carriers</h1>
          <p className="text-gray-600 mt-1.5 text-[15px]">
            Select a carrier to work on behalf of, add a new carrier and invite the owner, or request
            access to an existing account.
          </p>
        </div>

        {feedbackBanner}

        <section className="bg-white border rounded-2xl overflow-hidden mb-8">
          <div className="px-6 py-5 border-b bg-gray-50">
            <h2 className="text-lg font-semibold text-gray-900">Accessible carriers</h2>
            <p className="text-sm text-gray-600 mt-1">
              Organizations you created or were granted access to.
            </p>
          </div>

          {accessibleCarriers.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-gray-600">
              No carriers yet. Add a carrier below or request access using a USDOT number or company
              email.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-6 py-4 font-semibold text-gray-700">Company</th>
                    <th className="text-left px-6 py-4 font-semibold text-gray-700">USDOT</th>
                    <th className="text-left px-6 py-4 font-semibold text-gray-700">Access</th>
                    <th className="text-right px-6 py-4 font-semibold text-gray-700">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {accessibleCarriers.map((carrier) => {
                    const isActive = carrier.id === activeOrganizationId
                    return (
                      <tr key={carrier.id} className={isActive ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                        <td className="px-6 py-4 font-medium text-gray-900">
                          {organizationDisplayName(carrier)}
                        </td>
                        <td className="px-6 py-4 text-gray-700">
                          {carrier.usdot_number?.trim() || '—'}
                        </td>
                        <td className="px-6 py-4 text-gray-600 capitalize">
                          {carrier.access_source.replace('_', ' ')}
                          {carrier.membership_role ? ` · ${carrier.membership_role}` : ''}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleSelectCarrier(carrier)}
                            className={`text-sm px-3 py-1.5 rounded-lg border transition ${
                              isActive
                                ? 'border-blue-300 bg-blue-100 text-blue-900'
                                : 'border-gray-300 hover:bg-gray-100 text-gray-800'
                            }`}
                          >
                            {isActive ? 'Selected' : 'Select'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {canAddCarrier && (
          <section className="bg-white border rounded-2xl p-6 mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Add Carrier</h2>
            <p className="text-sm text-gray-500 mb-5">
              Enter the carrier company details and the Carrier Owner / Owner Operator contact. We
              save the carrier, grant you Permit Clerk access, and send a connection invite.
            </p>

            <form onSubmit={handleAddCarrier} className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-3">Company details</h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="add_company_name" className="block text-xs font-medium text-gray-600 mb-1">
                      Company Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="add_company_name"
                      required
                      value={addForm.company_name}
                      onChange={(e) => setAddForm((f) => ({ ...f, company_name: e.target.value }))}
                      placeholder="ABC Trucking LLC"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="add_usdot" className="block text-xs font-medium text-gray-600 mb-1">
                      USDOT#
                    </label>
                    <input
                      id="add_usdot"
                      value={addForm.usdot_number}
                      onChange={(e) => setAddForm((f) => ({ ...f, usdot_number: e.target.value }))}
                      placeholder="1234567"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="add_mc" className="block text-xs font-medium text-gray-600 mb-1">
                      MC#
                    </label>
                    <input
                      id="add_mc"
                      value={addForm.mc_number}
                      onChange={(e) => setAddForm((f) => ({ ...f, mc_number: e.target.value }))}
                      placeholder="MC-123456"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="add_ein" className="block text-xs font-medium text-gray-600 mb-1">
                      EIN
                    </label>
                    <input
                      id="add_ein"
                      value={addForm.ein}
                      onChange={(e) => setAddForm((f) => ({ ...f, ein: e.target.value }))}
                      placeholder="12-3456789"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="add_carrier_phone" className="block text-xs font-medium text-gray-600 mb-1">
                      Company phone
                    </label>
                    <input
                      id="add_carrier_phone"
                      value={addForm.carrier_phone}
                      onChange={(e) => setAddForm((f) => ({ ...f, carrier_phone: e.target.value }))}
                      placeholder="(555) 123-4567"
                      className={inputClass}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="add_carrier_address" className="block text-xs font-medium text-gray-600 mb-1">
                      Address
                    </label>
                    <input
                      id="add_carrier_address"
                      value={addForm.carrier_address}
                      onChange={(e) =>
                        setAddForm((f) => ({ ...f, carrier_address: e.target.value }))
                      }
                      placeholder="123 Main St, City, ST 00000"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="add_carrier_email" className="block text-xs font-medium text-gray-600 mb-1">
                      Company email
                    </label>
                    <input
                      id="add_carrier_email"
                      type="email"
                      value={addForm.carrier_email}
                      onChange={(e) => setAddForm((f) => ({ ...f, carrier_email: e.target.value }))}
                      placeholder="dispatch@carrier.com"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="add_insurance" className="block text-xs font-medium text-gray-600 mb-1">
                      Insurance Contact
                    </label>
                    <input
                      id="add_insurance"
                      value={addForm.insurance_contact}
                      onChange={(e) =>
                        setAddForm((f) => ({ ...f, insurance_contact: e.target.value }))
                      }
                      placeholder="Agent name / phone / email"
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-3">
                  Carrier Owner / Owner Operator contact
                </h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="add_invite_contact_name"
                      className="block text-xs font-medium text-gray-600 mb-1"
                    >
                      Full name
                    </label>
                    <input
                      id="add_invite_contact_name"
                      value={addForm.invite_contact_name}
                      onChange={(e) =>
                        setAddForm((f) => ({ ...f, invite_contact_name: e.target.value }))
                      }
                      placeholder="Jane Doe"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="add_invite_email" className="block text-xs font-medium text-gray-600 mb-1">
                      Invite email <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="add_invite_email"
                      type="email"
                      required
                      value={addForm.invite_email}
                      onChange={(e) => setAddForm((f) => ({ ...f, invite_email: e.target.value }))}
                      placeholder="owner@carrier.com"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="add_invite_phone" className="block text-xs font-medium text-gray-600 mb-1">
                      Invite phone (SMS, optional)
                    </label>
                    <input
                      id="add_invite_phone"
                      value={addForm.invite_phone}
                      onChange={(e) => setAddForm((f) => ({ ...f, invite_phone: e.target.value }))}
                      placeholder="(555) 987-6543"
                      className={inputClass}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="add_message" className="block text-xs font-medium text-gray-600 mb-1">
                      Message (optional)
                    </label>
                    <textarea
                      id="add_message"
                      value={addForm.message}
                      onChange={(e) => setAddForm((f) => ({ ...f, message: e.target.value }))}
                      rows={2}
                      placeholder="I'm your permit clerk — please accept so I can file permits for you."
                      className={inputClass}
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Invite email is required. The owner must sign in with that email to accept the
                  connection.
                </p>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={addingCarrier}
                  className="bg-black hover:bg-gray-900 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition"
                >
                  {addingCarrier ? 'Saving & inviting…' : 'Save & Send Invite'}
                </button>
              </div>
            </form>

            {lastInviteLink && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="font-medium mb-1">Shareable invite link</div>
                <a
                  href={lastInviteLink}
                  className="break-all underline text-amber-950"
                  target="_blank"
                  rel="noreferrer"
                >
                  {lastInviteLink}
                </a>
                <button
                  type="button"
                  onClick={() => void handleCopyInviteLink(lastInviteLink)}
                  className="mt-2 text-xs font-medium underline text-amber-950"
                >
                  Copy link
                </button>
              </div>
            )}
          </section>
        )}

        {(pendingConnectionInvites.length > 0 || invitesListError) && (
          <section className="bg-white border rounded-2xl overflow-hidden mb-8">
            <div className="px-6 py-5 border-b bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900">Pending connection invites</h2>
              <p className="text-sm text-gray-600 mt-1">
                Waiting for the carrier owner to accept.
              </p>
            </div>
            {invitesListError && (
              <div className="px-6 py-3 text-sm text-red-700 bg-red-50 border-b border-red-100">
                {invitesListError}
              </div>
            )}
            <ul className="divide-y">
              {pendingConnectionInvites.map((invite) => (
                <li
                  key={invite.id}
                  className="px-6 py-4 text-sm flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-medium text-gray-900">{invite.company_name}</div>
                    <div className="text-gray-500 text-xs mt-0.5">
                      {invite.invite_email || invite.invite_phone || 'No contact'}
                      {invite.expires_at
                        ? ` · expires ${new Date(invite.expires_at).toLocaleDateString()}`
                        : ''}
                    </div>
                    {invite.invite_link && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <a
                          href={invite.invite_link}
                          className="text-xs text-blue-700 underline break-all"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {invite.invite_link}
                        </a>
                        <button
                          type="button"
                          onClick={() => void handleCopyInviteLink(invite.invite_link!)}
                          className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                          Copy link
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border bg-amber-50 text-amber-800 border-amber-200">
                      pending
                    </span>
                    <button
                      type="button"
                      disabled={revokingId === invite.id}
                      onClick={() => void handleRevokeInvite(invite.id)}
                      className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {revokingId === invite.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="bg-white border rounded-2xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Request access</h2>
          <p className="text-sm text-gray-500 mb-5">
            Send an account link request by USDOT# or the carrier&apos;s company email. The primary
            owner can approve it from their profile.
          </p>

          <form onSubmit={handleRequestAccess} className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="request_usdot" className="block text-xs font-medium text-gray-600 mb-1">
                USDOT#
              </label>
              <input
                id="request_usdot"
                value={requestUsdot}
                onChange={(e) => setRequestUsdot(e.target.value)}
                placeholder="1234567"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="request_email" className="block text-xs font-medium text-gray-600 mb-1">
                Company email
              </label>
              <input
                id="request_email"
                type="email"
                value={requestEmail}
                onChange={(e) => setRequestEmail(e.target.value)}
                placeholder="dispatch@carrier.com"
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="request_message" className="block text-xs font-medium text-gray-600 mb-1">
                Message (optional)
              </label>
              <textarea
                id="request_message"
                value={requestMessage}
                onChange={(e) => setRequestMessage(e.target.value)}
                rows={3}
                placeholder="I'm your permit clerk and need access to file permits."
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="bg-black hover:bg-gray-900 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition"
              >
                {submitting ? 'Sending…' : 'Request Access'}
              </button>
            </div>
          </form>
        </section>

        {outgoingRequests.length > 0 && (
          <section className="bg-white border rounded-2xl overflow-hidden">
            <div className="px-6 py-5 border-b bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900">Your link requests</h2>
            </div>
            <ul className="divide-y">
              {outgoingRequests.map((request) => (
                <li
                  key={request.id}
                  className="px-6 py-4 text-sm flex flex-wrap items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-medium text-gray-900">
                      {request.target_usdot
                        ? `USDOT ${request.target_usdot}`
                        : request.target_email}
                    </div>
                    <div className="text-gray-500 text-xs mt-0.5">
                      {request.created_at ? new Date(request.created_at).toLocaleString() : ''}
                    </div>
                  </div>
                  <span
                    className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                      request.status === 'approved'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : request.status === 'rejected'
                          ? 'bg-red-50 text-red-800 border-red-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}
                  >
                    {request.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
