'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  completeDevAccountSwitch,
  persistDevTestPersonaEmail,
} from '@/lib/dev-account-switch'
import {
  DEV_BASE_OWNER_EMAIL,
  DEV_TEST_PERSONA_STORAGE_KEY,
  isDevAccountSwitcherEnabled,
} from '@/lib/dev-mode'
import { normalizeInviteEmail } from '@/lib/team-invites'

interface DevAccountSwitcherProps {
  currentEmail?: string | null
}

function buildDevSwitcherOptions(
  teamEmails: string[],
  currentEmail?: string | null,
  storedPersona?: string | null
): string[] {
  const values = new Set<string>([DEV_BASE_OWNER_EMAIL, ...teamEmails])

  const normalizedCurrent = normalizeInviteEmail(currentEmail)
  if (normalizedCurrent) values.add(normalizedCurrent)

  const normalizedStored = normalizeInviteEmail(storedPersona)
  if (
    normalizedStored &&
    (normalizedStored === normalizedCurrent || teamEmails.includes(normalizedStored))
  ) {
    values.add(normalizedStored)
  }

  const others = [...values].filter((email) => email !== DEV_BASE_OWNER_EMAIL).sort()
  return [DEV_BASE_OWNER_EMAIL, ...others]
}

export default function DevAccountSwitcher({ currentEmail }: DevAccountSwitcherProps) {
  const enabled = isDevAccountSwitcherEnabled()
  const [teamEmails, setTeamEmails] = useState<string[]>([])
  const [switchingEmail, setSwitchingEmail] = useState<string | null>(null)
  const [storedPersona, setStoredPersona] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadWarning, setLoadWarning] = useState<string | null>(null)

  const normalizedCurrentEmail = normalizeInviteEmail(currentEmail)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    if (normalizedCurrentEmail === DEV_BASE_OWNER_EMAIL) {
      window.localStorage.removeItem(DEV_TEST_PERSONA_STORAGE_KEY)
      setStoredPersona(null)
      return
    }

    setStoredPersona(window.localStorage.getItem(DEV_TEST_PERSONA_STORAGE_KEY))
  }, [enabled, normalizedCurrentEmail])

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    const supabase = createClient()

    async function loadTeamEmails() {
      setLoadWarning(null)

      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user?.id) return

      const actorEmail = normalizeInviteEmail(session.user.email)
      const { data: ownProfile, error: ownProfileError } = await supabase
        .from('member_profiles')
        .select('organization_id')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (ownProfileError) {
        if (!cancelled) {
          setLoadWarning('Could not load organization roster (member profile). Owner switch still works.')
        }
      }

      let orgId = ownProfile?.organization_id ?? null

      if (!orgId) {
        const { data: linkedRoster, error: linkedRosterError } = await supabase
          .from('team_member_profiles')
          .select('organization_id')
          .eq('linked_user_id', session.user.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (linkedRosterError && !cancelled) {
          setLoadWarning('Could not load organization roster. Owner switch still works.')
        }

        orgId = linkedRoster?.organization_id ?? null

        if (!orgId && actorEmail) {
          const { data: emailRoster, error: emailRosterError } = await supabase
            .from('team_member_profiles')
            .select('organization_id')
            .eq('driver_email', actorEmail)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (emailRosterError && !cancelled) {
            setLoadWarning('Could not load organization roster. Owner switch still works.')
          }

          orgId = emailRoster?.organization_id ?? null
        }
      }

      const emails = new Set<string>()

      if (orgId) {
        const [
          { data: roster, error: rosterError },
          { data: members, error: membersError },
        ] = await Promise.all([
          supabase
            .from('team_member_profiles')
            .select('driver_email')
            .eq('organization_id', orgId),
          supabase
            .from('member_profiles')
            .select('driver_email')
            .eq('organization_id', orgId),
        ])

        if ((rosterError || membersError) && !cancelled) {
          setLoadWarning('Could not load full team roster. Owner switch still works.')
        }

        for (const row of roster ?? []) {
          const email = normalizeInviteEmail(row.driver_email)
          if (email) emails.add(email)
        }
        for (const row of members ?? []) {
          const email = normalizeInviteEmail(row.driver_email)
          if (email) emails.add(email)
        }
      }

      if (!cancelled) {
        setTeamEmails([...emails].sort())
      }
    }

    void loadTeamEmails()
    return () => {
      cancelled = true
    }
  }, [enabled, currentEmail])

  const options = useMemo(
    () => buildDevSwitcherOptions(teamEmails, currentEmail, storedPersona),
    [teamEmails, currentEmail, storedPersona]
  )

  const selectValue =
    normalizedCurrentEmail && options.includes(normalizedCurrentEmail)
      ? normalizedCurrentEmail
      : DEV_BASE_OWNER_EMAIL

  const viewingAs = normalizedCurrentEmail || storedPersona || DEV_BASE_OWNER_EMAIL

  const canSwitchBackToOwner =
    Boolean(normalizedCurrentEmail) && normalizedCurrentEmail !== DEV_BASE_OWNER_EMAIL

  async function handleSwitch(email: string) {
    if (switchingEmail) return

    const normalizedTarget = normalizeInviteEmail(email)
    if (!normalizedTarget || normalizedTarget === normalizedCurrentEmail) return

    setSwitchingEmail(normalizedTarget)
    setError(null)

    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const accessToken = session?.access_token
      if (!accessToken) {
        throw new Error('Session expired. Please sign in again.')
      }

      const response = await fetch('/api/dev/switch-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ email: normalizedTarget }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to switch account')
      }

      const hashedToken = result.data?.hashed_token
      if (!hashedToken) {
        throw new Error('Missing sign-in token')
      }

      const switchResult = await completeDevAccountSwitch(supabase, normalizedTarget, hashedToken)
      if (!switchResult.success) {
        throw new Error(switchResult.error)
      }

      persistDevTestPersonaEmail(normalizedTarget)
      window.location.reload()
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : 'Failed to switch account')
      setSwitchingEmail(null)
    }
  }

  if (!enabled) return null

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="max-w-7xl mx-auto px-6 py-2 flex flex-wrap items-center gap-3 text-sm text-amber-900">
        <span className="font-medium">Test mode: viewing as {viewingAs}</span>
        <label className="flex items-center gap-2">
          <span className="text-xs text-amber-800">Switch account</span>
          <select
            value={selectValue}
            onChange={(e) => void handleSwitch(e.target.value)}
            disabled={Boolean(switchingEmail)}
            className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-sm text-gray-900 min-w-[220px]"
          >
            {options.map((email) => (
              <option key={email} value={email}>
                {email === DEV_BASE_OWNER_EMAIL ? `${email} (owner)` : email}
              </option>
            ))}
          </select>
        </label>
        {canSwitchBackToOwner && (
          <button
            type="button"
            onClick={() => void handleSwitch(DEV_BASE_OWNER_EMAIL)}
            disabled={Boolean(switchingEmail)}
            className="rounded-lg border border-amber-400 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
          >
            {switchingEmail === DEV_BASE_OWNER_EMAIL
              ? 'Switching to owner…'
              : 'Switch back to owner'}
          </button>
        )}
        {loadWarning && <span className="text-xs text-amber-800">{loadWarning}</span>}
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </div>
  )
}