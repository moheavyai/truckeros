'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  setActiveOrganizationId,
  setWorkspaceMode,
} from '@/lib/organization-context'
import { SERVICE_MODE_ELIGIBLE_ROLES } from '@/lib/service-mode-scope'
import type { TeamInviteRow } from '@/lib/team-invites'

type InvitePreview = Pick<
  TeamInviteRow,
  'id' | 'role' | 'invite_email' | 'organization_id' | 'expires_at'
>

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const token = decodeURIComponent(params.token ?? '')

  const [loading, setLoading] = useState(true)
  const [invite, setInvite] = useState<InvitePreview | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [messageTone, setMessageTone] = useState<'error' | 'info'>('error')
  const [accepting, setAccepting] = useState(false)
  const [needsSignIn, setNeedsSignIn] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadInvite() {
      if (!token) {
        setMessage('Invalid invite link')
        setMessageTone('error')
        setLoading(false)
        return
      }

      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        if (!cancelled) {
          setNeedsSignIn(true)
          setLoading(false)
        }
        return
      }

      const response = await fetch(`/api/team-invites/accept?token=${encodeURIComponent(token)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const result = await response.json()

      if (cancelled) return

      if (!response.ok || !result.success) {
        setMessage(result.error || 'Invite not found or no longer valid')
        setMessageTone('error')
        setLoading(false)
        return
      }

      setInvite(result.data as InvitePreview)
      setLoading(false)
    }

    void loadInvite()
    return () => {
      cancelled = true
    }
  }, [token])

  async function handleAccept() {
    if (!token) return
    setAccepting(true)
    setMessage(null)

    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        setAccepting(false)
        router.push(`/login?redirect=${encodeURIComponent(`/invite/${token}`)}`)
        return
      }

      const response = await fetch('/api/team-invites/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ token }),
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        setMessage(result.error || 'Failed to accept invite')
        setMessageTone('error')
        setAccepting(false)
        return
      }

      const organizationId =
        (result.data?.organization_id as string | undefined) ?? invite?.organization_id ?? null
      const joinedRole = String(result.data?.role ?? invite?.role ?? '')
      const multiOrgJoin = result.data?.multi_org_join === true
      const serviceEligible = (SERVICE_MODE_ELIGIBLE_ROLES as readonly string[]).includes(
        joinedRole
      )

      // Only force service mode for multi-org joins with service-eligible roles.
      // First-time home org join stays in carrier mode.
      if (multiOrgJoin && serviceEligible && organizationId) {
        setActiveOrganizationId(organizationId)
        setWorkspaceMode('service')
      }

      setMessageTone('info')
      setMessage('Invite accepted. Taking you to your profile…')
      // Brief delay so success message can paint before navigation.
      window.setTimeout(() => {
        router.push('/profile?invite=accepted')
      }, 400)
    } catch {
      setMessage('Failed to accept invite')
      setMessageTone('error')
      setAccepting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">Loading invite…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="max-w-md w-full bg-white border rounded-2xl p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Team Invite</h1>
        {invite ? (
          <>
            <p className="mt-3 text-gray-600">
              You have been invited to join an organization as{' '}
              <span className="font-medium text-gray-900">{invite.role}</span>.
            </p>
            {invite.invite_email && (
              <p className="mt-2 text-sm text-gray-500">Invited email: {invite.invite_email}</p>
            )}
          </>
        ) : needsSignIn ? (
          <p className="mt-3 text-gray-600">
            Sign in with the email that received this invite to review and accept it.
          </p>
        ) : (
          <p className="mt-3 text-gray-600">{message ?? 'Invite not found.'}</p>
        )}

        {message && (invite || messageTone === 'info') && (
          <p
            className={`mt-4 text-sm rounded-lg px-3 py-2 border ${
              messageTone === 'error'
                ? 'text-red-700 bg-red-50 border-red-200'
                : 'text-emerald-800 bg-emerald-50 border-emerald-200'
            }`}
          >
            {message}
          </p>
        )}

        {invite && (
          <button
            type="button"
            onClick={() => void handleAccept()}
            disabled={accepting}
            className="mt-6 w-full rounded-xl bg-black hover:bg-gray-900 disabled:opacity-50 text-white py-3 text-sm font-semibold transition"
          >
            {accepting ? 'Accepting…' : 'Accept invite'}
          </button>
        )}

        {needsSignIn && (
          <button
            type="button"
            onClick={() => router.push(`/login?redirect=${encodeURIComponent(`/invite/${token}`)}`)}
            className="mt-6 w-full rounded-xl bg-black hover:bg-gray-900 text-white py-3 text-sm font-semibold transition"
          >
            Sign in to view invite
          </button>
        )}
      </div>
    </div>
  )
}
