'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  setActiveOrganizationId,
  setWorkspaceMode,
} from '@/lib/organization-context'

type CarrierInvitePreview = {
  id: string
  company_name: string
  usdot_number?: string | null
  invite_email?: string | null
  invite_contact_name?: string | null
  organization_id?: string | null
  expires_at: string
}

export default function CarrierInviteAcceptPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const token = decodeURIComponent(params.token ?? '')

  const [loading, setLoading] = useState(true)
  const [invite, setInvite] = useState<CarrierInvitePreview | null>(null)
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

      try {
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

        const response = await fetch(
          `/api/carrier-connection-invites/accept?token=${encodeURIComponent(token)}`,
          {
            headers: { Authorization: `Bearer ${session.access_token}` },
          }
        )

        let result: { success?: boolean; error?: string; data?: CarrierInvitePreview } = {}
        try {
          result = await response.json()
        } catch {
          if (!cancelled) {
            setMessage('Failed to load invite. Please try again.')
            setMessageTone('error')
            setLoading(false)
          }
          return
        }

        if (cancelled) return

        if (!response.ok || !result.success) {
          setMessage(result.error || 'Invite not found or no longer valid')
          setMessageTone('error')
          setLoading(false)
          return
        }

        setInvite(result.data as CarrierInvitePreview)
        setLoading(false)
      } catch {
        if (!cancelled) {
          setMessage('Failed to load invite. Please try again.')
          setMessageTone('error')
          setLoading(false)
        }
      }
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
        router.push(`/login?redirect=${encodeURIComponent(`/carrier-invite/${token}`)}`)
        return
      }

      const response = await fetch('/api/carrier-connection-invites/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ token }),
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        setMessage(result.error || 'Failed to accept connection')
        setMessageTone('error')
        setAccepting(false)
        return
      }

      const organizationId =
        (result.data?.organization_id as string | undefined) ??
        invite?.organization_id ??
        null

      // Carrier owners work in carrier mode on their new org.
      if (organizationId) {
        setActiveOrganizationId(organizationId)
        setWorkspaceMode('carrier')
      }

      setMessageTone('info')
      setMessage('Connection accepted. Taking you to your profile…')
      window.setTimeout(() => {
        router.push('/profile?carrier_connection=accepted')
      }, 400)
    } catch {
      setMessage('Failed to accept connection')
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
        <h1 className="text-2xl font-semibold text-gray-900">Carrier Connection</h1>
        {invite ? (
          <>
            <p className="mt-3 text-gray-600">
              A permit clerk invited you to connect as the Carrier Owner for{' '}
              <span className="font-medium text-gray-900">{invite.company_name}</span>
              {invite.usdot_number?.trim() ? (
                <span className="text-gray-500"> (USDOT {invite.usdot_number.trim()})</span>
              ) : null}
              .
            </p>
            {invite.invite_email && (
              <p className="mt-2 text-sm text-gray-500">Invited email: {invite.invite_email}</p>
            )}
          </>
        ) : needsSignIn ? (
          <p className="mt-3 text-gray-600">
            Sign in with the email that received this invite to review and accept the connection.
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
            {accepting ? 'Accepting…' : 'Accept connection'}
          </button>
        )}

        {needsSignIn && (
          <button
            type="button"
            onClick={() =>
              router.push(`/login?redirect=${encodeURIComponent(`/carrier-invite/${token}`)}`)
            }
            className="mt-6 w-full rounded-xl bg-black hover:bg-gray-900 text-white py-3 text-sm font-semibold transition"
          >
            Sign in to view invite
          </button>
        )}
      </div>
    </div>
  )
}
