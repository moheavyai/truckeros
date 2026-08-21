'use client'

/**
 * /settings/api-keys
 *
 * Owner/Admin UI to create, list, revoke, and delete org-scoped API keys
 * used by external agents (Grok bots, partners) against /api/v1/tools/*.
 *
 * Security UX:
 *   - Raw key is shown only once, immediately after create
 *   - Copy button + clear warning
 *   - Revoke is soft (revoked_at); Delete is hard
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppHeader from '@/components/AppHeader'
import SuccessToast from '@/components/SuccessToast'
import { hasOwnerOrAdminRole } from '@/lib/team-permissions'
import type { UserRole } from '@/types/member-profile'

type ApiKeyRow = {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
  created_at: string
  created_by_user_id: string | null
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function ApiKeysSettingsPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [ownOrganizationId, setOwnOrganizationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [revealedName, setRevealedName] = useState<string>('')
  const [copied, setCopied] = useState(false)

  const [toast, setToast] = useState<string | null>(null)

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const supabase = createClient()
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }, [])

  const loadKeys = useCallback(async () => {
    const token = await getAccessToken()
    if (!token) return

    setListError(null)
    try {
      const res = await fetch('/api/api-keys', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) {
        setListError(json.error || 'Failed to load keys')
        setKeys([])
        return
      }
      setKeys(json.keys || [])
      if (json.organization_id) setOwnOrganizationId(json.organization_id)
    } catch (err: any) {
      setListError(err?.message || 'Failed to load keys')
    }
  }, [getAccessToken])

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return
      if (!session) {
        router.push('/login')
        return
      }

      setUser(session.user)

      const { data: profile } = await supabase
        .from('member_profiles')
        .select('organization_id, is_primary_owner, user_roles')
        .eq('user_id', session.user.id)
        .maybeSingle()

      const { data: memberships } = await supabase
        .from('organization_memberships')
        .select('organization_id, role, is_primary_owner')
        .eq('user_id', session.user.id)
        .limit(20)

      if (cancelled) return

      if (profile?.organization_id) {
        setOwnOrganizationId(profile.organization_id)
      }

      const roles = (profile?.user_roles as UserRole[] | undefined) || []
      const membershipRoles = (memberships || []).map((m: any) => m.role).filter(Boolean)
      const combinedRoles = Array.from(new Set([...roles, ...membershipRoles])) as UserRole[]
      const isPrimary =
        profile?.is_primary_owner === true ||
        (memberships || []).some((m: any) => m.is_primary_owner)

      const allowed = hasOwnerOrAdminRole({
        user_roles: combinedRoles,
        is_primary_owner: isPrimary,
      })

      setAuthorized(allowed)
      setLoading(false)

      if (allowed) {
        await loadKeys()
      }
    })

    return () => {
      cancelled = true
    }
  }, [router, loadKeys])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    setBusy(true)
    try {
      const token = await getAccessToken()
      if (!token) {
        setCreateError('Not signed in')
        return
      }

      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newName.trim() || 'API key',
          env: 'live',
          scopes: ['analyze_permit'],
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setCreateError(json.error || 'Failed to create key')
        return
      }

      setRevealedKey(json.raw_key || null)
      setRevealedName(json.key?.name || newName || 'API key')
      setCopied(false)
      setNewName('')
      await loadKeys()
      setToast('API key created')
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create key')
    } finally {
      setBusy(false)
    }
  }

  const handleRevoke = async (id: string, name: string) => {
    if (!window.confirm(`Revoke “${name}”? External bots using this key will stop working immediately.`)) {
      return
    }
    setBusy(true)
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(`/api/api-keys/${id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'revoke' }),
      })
      const json = await res.json()
      if (!res.ok) {
        setListError(json.error || 'Failed to revoke')
        return
      }
      await loadKeys()
      setToast('Key revoked')
    } catch (err: any) {
      setListError(err?.message || 'Failed to revoke')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Permanently delete “${name}”? This cannot be undone.`)) {
      return
    }
    setBusy(true)
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(`/api/api-keys/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) {
        setListError(json.error || 'Failed to delete')
        return
      }
      await loadKeys()
      setToast('Key deleted')
    } catch (err: any) {
      setListError(err?.message || 'Failed to delete')
    } finally {
      setBusy(false)
    }
  }

  const copyRevealed = async () => {
    if (!revealedKey) return
    try {
      await navigator.clipboard.writeText(revealedKey)
      setCopied(true)
      setToast('Key copied to clipboard')
    } catch {
      // Fallback: text is still visible in the dialog
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-14 h-14 bg-black rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <span className="text-white text-3xl font-bold tracking-tighter">M</span>
          </div>
          <p className="text-gray-700 font-semibold text-lg">Loading…</p>
        </div>
      </div>
    )
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader user={user} ownOrganizationId={ownOrganizationId} />
        <main className="max-w-3xl mx-auto px-4 py-10">
          <h1 className="text-2xl font-semibold text-gray-900">API keys</h1>
          <p className="mt-3 text-gray-700">
            Only Owner or Admin can manage API keys for this organization.
          </p>
          <a
            href="/profile"
            className="inline-flex mt-6 min-h-[44px] items-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
          >
            ← Back to Profile
          </a>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader user={user} ownOrganizationId={ownOrganizationId} />

      <main className="max-w-3xl mx-auto px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8">
          <a href="/profile" className="text-sm font-medium text-gray-600 hover:text-black">
            ← Profile
          </a>
          <h1 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">
            API keys
          </h1>
          <p className="mt-2 text-[15px] text-gray-700 sm:text-gray-600 max-w-2xl">
            Create keys so external agents and Grok bots can call the MoHeavy Permit
            Engine (<code className="text-sm bg-gray-100 px-1 rounded">/api/v1/tools/*</code>).
            Keys are scoped to your organization. The secret is shown only once.
          </p>
        </div>

        <section className="bg-white border border-gray-300 sm:border-gray-200 rounded-2xl p-5 sm:p-6 mb-8">
          <h2 className="font-semibold text-gray-900">Create a new key</h2>
          <form onSubmit={handleCreate} className="mt-4 flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name (e.g. Grok Bot – Midwest)"
              maxLength={120}
              className="flex-1 min-h-[44px] rounded-xl border border-gray-400 sm:border-gray-300 px-4 text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] shrink-0 rounded-xl bg-black px-5 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-60 touch-manipulation"
            >
              {busy ? 'Creating…' : 'Create key'}
            </button>
          </form>
          {createError && (
            <p className="mt-3 text-sm text-red-700" role="alert">
              {createError}
            </p>
          )}
          <p className="mt-3 text-xs text-gray-600">
            Default scope: <span className="font-medium">analyze_permit</span>
          </p>
        </section>

        <section className="bg-white border border-gray-300 sm:border-gray-200 rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="font-semibold text-gray-900">Your keys</h2>
            <button
              type="button"
              onClick={() => loadKeys()}
              className="text-sm font-medium text-gray-700 hover:text-black"
            >
              Refresh
            </button>
          </div>

          {listError && (
            <p className="mb-4 text-sm text-red-700" role="alert">
              {listError}
            </p>
          )}

          {keys.length === 0 ? (
            <p className="text-sm text-gray-600 py-6 text-center">
              No API keys yet. Create one above to let external bots call the permit engine.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {keys.map((k) => {
                const revoked = !!k.revoked_at
                return (
                  <li key={k.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900">{k.name}</span>
                          {revoked ? (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-800 border border-red-200">
                              Revoked
                            </span>
                          ) : (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-gray-600 font-mono">
                          {k.key_prefix}…
                        </div>
                        <div className="mt-1.5 text-xs text-gray-500 space-y-0.5">
                          <div>Scopes: {(k.scopes || []).join(', ') || '—'}</div>
                          <div>Created: {formatWhen(k.created_at)}</div>
                          <div>Last used: {formatWhen(k.last_used_at)}</div>
                          {revoked && <div>Revoked: {formatWhen(k.revoked_at)}</div>}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        {!revoked && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleRevoke(k.id, k.name)}
                            className="min-h-[40px] px-3 rounded-lg border border-amber-400 text-sm font-medium text-amber-950 hover:bg-amber-50 disabled:opacity-60 touch-manipulation"
                          >
                            Revoke
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleDelete(k.id, k.name)}
                          className="min-h-[40px] px-3 rounded-lg border border-gray-300 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60 touch-manipulation"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <div className="mt-8 rounded-2xl border border-gray-200 bg-gray-100/80 p-4 text-sm text-gray-700">
          <p className="font-medium text-gray-900">How to use a key</p>
          <pre className="mt-2 overflow-x-auto text-xs bg-white border border-gray-200 rounded-xl p-3 text-gray-800">
{`curl -X POST https://moheavy.com/api/v1/tools/analyze-permit \\
  -H "Authorization: Bearer mh_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{ "origin": { "city": "…", "state": "MO" }, … }'`}
          </pre>
        </div>
      </main>

      {revealedKey && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close"
            onClick={() => setRevealedKey(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="New API key"
            className="relative z-10 w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5 sm:p-6 mx-0 sm:mx-4"
          >
            <h3 className="text-lg font-semibold text-gray-900">Copy your key now</h3>
            <p className="mt-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              This is the only time the full key is shown. Store it securely — it cannot be recovered.
            </p>
            <p className="mt-3 text-xs text-gray-600">
              Name: <span className="font-medium text-gray-900">{revealedName}</span>
            </p>
            <div className="mt-3 flex gap-2">
              <code className="flex-1 min-h-[44px] break-all rounded-xl border border-gray-300 bg-gray-50 px-3 py-3 text-xs sm:text-sm font-mono text-gray-900">
                {revealedKey}
              </code>
            </div>
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={copyRevealed}
                className="min-h-[44px] flex-1 rounded-xl bg-black text-white text-sm font-semibold hover:bg-gray-900 touch-manipulation"
              >
                {copied ? 'Copied' : 'Copy key'}
              </button>
              <button
                type="button"
                onClick={() => setRevealedKey(null)}
                className="min-h-[44px] flex-1 rounded-xl border border-gray-300 text-sm font-semibold text-gray-900 hover:bg-gray-50 touch-manipulation"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <SuccessToast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}