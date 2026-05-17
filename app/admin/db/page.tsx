'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function AdminDatabasePage() {
  const [user, setUser] = useState<any>(null)
  const [loadingAuth, setLoadingAuth] = useState(true)
  const router = useRouter()

  const [migrationStatus, setMigrationStatus] = useState<any>(null)
  const [checking, setChecking] = useState(false)
  const [stateRulesStatus, setStateRulesStatus] = useState<any>(null)

  const MIGRATION_SQL = `ALTER TABLE IF EXISTS permit_requests
  ADD COLUMN IF NOT EXISTS cost_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS distance_miles NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS duration_hours NUMERIC(6,2);`

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)
      }
      setLoadingAuth(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [router])

  // Auto-check on load
  useEffect(() => {
    if (!loadingAuth && user) {
      checkMigrationStatus()
      checkStateRulesStatus()
    }
  }, [loadingAuth, user])

  async function checkMigrationStatus() {
    setChecking(true)
    try {
      const res = await fetch('/api/admin/migrate')
      const data = await res.json()
      setMigrationStatus(data)
    } catch (e: any) {
      setMigrationStatus({ hasAdmin: false, error: e.message })
    } finally {
      setChecking(false)
    }
  }

  async function checkStateRulesStatus() {
    try {
      const supabase = createClient()
      const { data, error, count } = await supabase
        .from('state_permit_rules')
        .select('*', { count: 'exact', head: true })

      setStateRulesStatus({
        exists: !error,
        count: count ?? 0,
        error: error?.message,
      })
    } catch (e: any) {
      setStateRulesStatus({ exists: false, error: e.message })
    }
  }

  async function showMigrationSQL() {
    const res = await fetch('/api/admin/migrate', { method: 'POST' })
    const data = await res.json()

    const fullInstructions = `Run this SQL in Supabase SQL Editor:

${data.sql || MIGRATION_SQL}

After running, click "Refresh Status" above.`

    navigator.clipboard.writeText(data.sql || MIGRATION_SQL)
    alert(fullInstructions + '\n\n✅ SQL has been copied to your clipboard.')
  }

  if (loadingAuth) {
    return <div className="p-8">Loading...</div>
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🗄️</span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">TruckerOS Admin • Database</h1>
            <p className="text-sm text-gray-500">Schema Management &amp; Migrations</p>
          </div>
        </div>
        <p className="mt-1 text-sm text-gray-600">Signed in as {user?.email}</p>
      </div>

      {/* permit_requests Migration */}
      <div className="mb-8 rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">permit_requests Table</h2>
            <p className="text-sm text-gray-500">Phase I columns for cost breakdown + route metadata</p>
          </div>
          <button
            onClick={checkMigrationStatus}
            disabled={checking}
            className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-black disabled:bg-gray-400"
          >
            {checking ? 'Checking...' : 'Refresh Status'}
          </button>
        </div>

        {migrationStatus ? (
          migrationStatus.hasAdmin && migrationStatus.columnsExist ? (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-green-700">
              ✅ <strong>All columns present</strong><br />
              <span className="text-sm">cost_breakdown (JSONB), distance_miles, duration_hours are available.</span>
            </div>
          ) : (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
              <div className="mb-3 text-amber-700">
                <strong>Migration required</strong> — The following columns are missing:
              </div>
              <ul className="mb-4 list-inside list-disc text-sm text-amber-800">
                <li>cost_breakdown JSONB</li>
                <li>distance_miles NUMERIC(8,2)</li>
                <li>duration_hours NUMERIC(6,2)</li>
              </ul>

              <button
                onClick={showMigrationSQL}
                className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-700"
              >
                Copy SQL &amp; Show Instructions
              </button>
              <p className="mt-2 text-xs text-amber-600">
                Run the SQL in Supabase Dashboard → SQL Editor, then refresh status.
              </p>
            </div>
          )
        ) : (
          <p className="text-gray-500">Click "Refresh Status" to check the current schema.</p>
        )}

        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium text-gray-600">Show raw migration SQL</summary>
          <pre className="mt-2 overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100">{MIGRATION_SQL}</pre>
        </details>
      </div>

      {/* state_permit_rules Status */}
      <div className="mb-8 rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">state_permit_rules Table</h2>
            <p className="text-sm text-gray-500">Data-driven permit thresholds per state</p>
          </div>
          <button
            onClick={checkStateRulesStatus}
            className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-black"
          >
            Refresh
          </button>
        </div>

        {stateRulesStatus ? (
          stateRulesStatus.exists ? (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-green-700">
              ✅ Table exists with <strong>{stateRulesStatus.count}</strong> state rules loaded.
              <div className="mt-1 text-sm">
                Run <code className="rounded bg-green-100 px-1">npm run seed:state-rules</code> to (re)populate data.
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">
              ❌ Table does not exist yet.<br />
              <span className="text-sm">Please run the migration: <code>001_create_state_permit_rules.sql</code></span>
            </div>
          )
        ) : (
          <p className="text-gray-500">Checking state permit rules table...</p>
        )}
      </div>

      {/* Quick Actions */}
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold">Quick Actions</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <a
            href="/permit-test"
            className="block rounded-lg border p-4 hover:bg-gray-50"
          >
            <div className="font-medium">← Back to Permit Agent Test</div>
            <div className="text-sm text-gray-500">Test loads with the full agent + visual corridor</div>
          </a>

          <button
            onClick={() => {
              navigator.clipboard.writeText(MIGRATION_SQL)
              alert('Migration SQL copied to clipboard!')
            }}
            className="rounded-lg border p-4 text-left hover:bg-gray-50"
          >
            <div className="font-medium">📋 Copy permit_requests Migration SQL</div>
            <div className="text-sm text-gray-500">For manual execution in Supabase SQL Editor</div>
          </button>

          <a
            href="/supabase/migrations/001_create_state_permit_rules.sql"
            target="_blank"
            className="block rounded-lg border p-4 hover:bg-gray-50"
          >
            <div className="font-medium">View state_permit_rules Migration</div>
            <div className="text-sm text-gray-500">Open the SQL file for the rules table</div>
          </a>

          <div className="rounded-lg border p-4">
            <div className="font-medium">Seed State Rules</div>
            <div className="text-sm text-gray-500 mb-2">Run in terminal:</div>
            <code className="block rounded bg-gray-900 p-2 text-xs text-white">npm run seed:state-rules</code>
          </div>
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-gray-400">
        TruckerOS Phase I • Admin Database Tools
      </p>
    </div>
  )
}
