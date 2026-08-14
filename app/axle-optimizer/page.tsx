'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import AxleConfigurator from '@/components/AxleConfigurator'
import { createClient } from '@/lib/supabase/client'

const mutedTextClass = 'text-gray-600 sm:text-gray-500'
const bodyTextClass = 'text-gray-700 sm:text-gray-600'

/**
 * Axle Group Optimizer — spacing-based federal/state group planner.
 * Auth-gated like equipment / permit-test. Configurator mounts only after user is known.
 */
export default function AxleOptimizerPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [ownOrganizationId, setOwnOrganizationId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return
      if (!session) {
        router.push('/login')
        setLoading(false)
        return
      }
      setUser(session.user)

      try {
        const { data: profile } = await supabase
          .from('member_profiles')
          .select('organization_id')
          .eq('user_id', session.user.id)
          .maybeSingle()
        if (!cancelled && profile?.organization_id) {
          setOwnOrganizationId(profile.organization_id)
        }
      } catch {
        // non-fatal — header workspace bar only
      } finally {
        if (!cancelled) setLoading(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setUser(null)
        router.push('/login')
        return
      }
      setUser(session.user)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [router])

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-14 h-14 bg-black rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <span className="text-white text-3xl font-bold tracking-tighter">M</span>
          </div>
          <p className="text-gray-700 font-semibold text-lg">Checking authentication...</p>
          <p className={`${mutedTextClass} text-sm mt-1`}>Please wait while we verify your session</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader user={user} ownOrganizationId={ownOrganizationId} />

      <main className="max-w-5xl mx-auto px-4 py-6 sm:px-6 sm:py-10 min-w-0">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Tools</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900 mt-1">
            Axle Group Optimizer
          </h1>
          <p className={`${bodyTextClass} mt-2 text-sm sm:text-[15px] max-w-2xl`}>
            Plan federal and state axle groups by spacing — tandems, spreads, tridems, quads, and
            bridge formula — for 5-axle Class 8 and OSOW corridors. Separate from equipment role
            groups (steer/drives/jeep) on the Equipment page.
          </p>
        </div>

        {/* Only mount after authenticated user is known */}
        <AxleConfigurator />
      </main>
    </div>
  )
}
