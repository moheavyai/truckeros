'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type MigrationStatus = {
  hasAdmin?: boolean
  columnsExist?: boolean | null
  needsMigration?: boolean
  missingColumns?: string[]
  inconclusiveChecks?: string[]
  migration002Sql?: string
  migration014Sql?: string
  migration017Sql?: string
  migration031Sql?: string
  migration033Sql?: string
  /** Targeted 035: carrier_connection_invites (Carriers page) */
  migration035Sql?: string
  migration036Sql?: string
  /** Phase 1b: membership SELECT restore + SM helper Permit Clerk only */
  migration037Sql?: string
  /** Phase 1 PE: self-Clerk triggers + accept inviter Clerk */
  migration038Sql?: string
  /** Phase 1 PE: self-INSERT Clerk block + team invite accept GUC */
  migration039Sql?: string
  /** Phase 1 PE: team_invites self-Clerk on UPDATE */
  migration040Sql?: string
  /** Phase 1 PE: team_invites self-Clerk session contact match */
  migration041Sql?: string
  sql?: string
  applied?: boolean
  needsManualRun?: boolean
  success?: boolean
  message?: string
  error?: string
  correlationId?: string
  adminAccessDenied?: boolean
  authRequired?: boolean
  carrierConnectionInvitesMigrationAttempted?: boolean
  carrierConnectionInvitesMigrationApplied?: boolean
}

export default function AdminDatabasePage() {
  const [user, setUser] = useState<any>(null)
  const [loadingAuth, setLoadingAuth] = useState(true)
  const router = useRouter()

  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [stateRulesStatus, setStateRulesStatus] = useState<any>(null)

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
      if (res.status === 401) {
        setMigrationStatus({
          authRequired: true,
          error: 'Admin access required. Sign in with an admin account.',
        })
        return
      }
      if (res.status === 403) {
        setMigrationStatus({
          adminAccessDenied: true,
          error: 'Admin access required. Your account is not authorized for schema management.',
        })
        return
      }
      const data = await res.json()
      setMigrationStatus(data)
    } catch (e: any) {
      setMigrationStatus({ error: e.message })
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

  async function applyMigration() {
    setApplying(true)
    try {
      const res = await fetch('/api/admin/migrate', { method: 'POST' })
      if (res.status === 401 || res.status === 403) {
        alert('Admin access required to apply migrations.')
        return
      }
      const data = await res.json()
      setMigrationStatus(data)

      if (data.applied && data.success) {
        alert('Migration applied successfully. All required columns are now available.')
      } else if (data.needsManualRun && data.sql) {
        navigator.clipboard.writeText(data.sql)
        alert(
          'Live apply unavailable or incomplete. SQL copied to clipboard — run it in Supabase SQL Editor, then refresh status.'
        )
      } else if (data.error) {
        alert(`Migration failed: ${data.error}`)
      }
    } catch (e: any) {
      setMigrationStatus({ error: e.message })
    } finally {
      setApplying(false)
      setTimeout(checkMigrationStatus, 1500)
    }
  }

  function getCachedMigrationSql(status: MigrationStatus | null = migrationStatus): string {
    if (!status) return ''
    return (
      status.sql ||
      status.migration017Sql ||
      status.migration014Sql ||
      status.migration002Sql ||
      ''
    )
  }

  function carrierConnectionInvitesNeedsRepair(status: MigrationStatus | null): boolean {
    if (!status) return false
    const missing = status.missingColumns ?? []
    const inconclusive = status.inconclusiveChecks ?? []
    return (
      missing.some((c) => c.startsWith('carrier_connection_invites.')) ||
      inconclusive.includes('carrier_connection_invites')
    )
  }

  async function copyMigrationSql() {
    let sql = getCachedMigrationSql()

    if (!sql) {
      const res = await fetch('/api/admin/migrate')
      if (res.status === 401 || res.status === 403) {
        alert('Admin access required to copy migration SQL.')
        return
      }
      const data = await res.json()
      setMigrationStatus((prev) => ({ ...prev, ...data }))
      sql = getCachedMigrationSql(data)
    }

    if (!sql) {
      alert('No migration SQL available. Refresh status first.')
      return
    }

    navigator.clipboard.writeText(sql)
    alert('Migration SQL copied to clipboard. Run it in Supabase SQL Editor, then refresh status.')
  }

  async function copyCarrierConnectionInvitesSql() {
    let sql = migrationStatus?.migration035Sql
    if (!sql) {
      const res = await fetch('/api/admin/migrate')
      if (res.status === 401 || res.status === 403) {
        alert('Admin access required to copy migration SQL.')
        return
      }
      const data = await res.json()
      setMigrationStatus((prev) => ({ ...prev, ...data }))
      sql = data.migration035Sql
    }
    if (!sql) {
      alert('migration035Sql not available. Refresh status first.')
      return
    }
    navigator.clipboard.writeText(sql)
    alert(
      'Migration 035 (carrier_connection_invites) copied. Run in Supabase SQL Editor, then refresh status.'
    )
  }

  async function copyMigration037Sql() {
    let sql = migrationStatus?.migration037Sql
    if (!sql) {
      const res = await fetch('/api/admin/migrate')
      if (res.status === 401 || res.status === 403) {
        alert('Admin access required to copy migration SQL.')
        return
      }
      const data = await res.json()
      setMigrationStatus((prev) => ({ ...prev, ...data }))
      sql = data.migration037Sql
    }
    if (!sql) {
      alert('migration037Sql not available. Refresh status first.')
      return
    }
    navigator.clipboard.writeText(sql)
    alert(
      'Migration 037 (Phase 1b membership SELECT + SM Clerk helper) copied. Run in Supabase SQL Editor, then refresh status.'
    )
  }

  async function copyMigration038Sql() {
    let sql = migrationStatus?.migration038Sql
    if (!sql) {
      const res = await fetch('/api/admin/migrate')
      if (res.status === 401 || res.status === 403) {
        alert('Admin access required to copy migration SQL.')
        return
      }
      const data = await res.json()
      setMigrationStatus((prev) => ({ ...prev, ...data }))
      sql = data.migration038Sql
    }
    if (!sql) {
      alert('migration038Sql not available. Refresh status first.')
      return
    }
    navigator.clipboard.writeText(sql)
    alert(
      'Migration 038 (self-Clerk PE triggers + accept inviter Clerk) copied. Run in Supabase SQL Editor, then refresh status.'
    )
  }

  async function copyMigration039Sql() {
    let sql = migrationStatus?.migration039Sql
    if (!sql) {
      const res = await fetch('/api/admin/migrate')
      if (res.status === 401 || res.status === 403) {
        alert('Admin access required to copy migration SQL.')
        return
      }
      const data = await res.json()
      setMigrationStatus((prev) => ({ ...prev, ...data }))
      sql = data.migration039Sql
    }
    if (!sql) {
      alert('migration039Sql not available. Refresh status first.')
      return
    }
    navigator.clipboard.writeText(sql)
    alert(
      'Migration 039 (self-INSERT Clerk block + invite accept GUC) copied. Run in Supabase SQL Editor, then refresh status.'
    )
  }

  async function copyMigration040Sql() {
    let sql = migrationStatus?.migration040Sql
    if (!sql) {
      const res = await fetch('/api/admin/migrate')
      if (res.status === 401 || res.status === 403) {
        alert('Admin access required to copy migration SQL.')
        return
      }
      const data = await res.json()
      setMigrationStatus((prev) => ({ ...prev, ...data }))
      sql = data.migration040Sql
    }
    if (!sql) {
      alert('migration040Sql not available. Refresh status first.')
      return
    }
    navigator.clipboard.writeText(sql)
    alert(
      'Migration 040 (team invite self-Clerk on UPDATE) copied. Run in Supabase SQL Editor, then refresh status.'
    )
  }

  async function copyMigration041Sql() {
    let sql = migrationStatus?.migration041Sql
    if (!sql) {
      const res = await fetch('/api/admin/migrate')
      if (res.status === 401 || res.status === 403) {
        alert('Admin access required to copy migration SQL.')
        return
      }
      const data = await res.json()
      setMigrationStatus((prev) => ({ ...prev, ...data }))
      sql = data.migration041Sql
    }
    if (!sql) {
      alert('migration041Sql not available. Refresh status first.')
      return
    }
    navigator.clipboard.writeText(sql)
    alert(
      'Migration 041 (team invite self-Clerk session match) copied. Run in Supabase SQL Editor, then refresh status.'
    )
  }

  const showPhase1SqlTools =
    Boolean(migrationStatus?.hasAdmin) &&
    !migrationStatus?.authRequired &&
    !migrationStatus?.adminAccessDenied

  const displaySql =
    migrationStatus?.migration035Sql && carrierConnectionInvitesNeedsRepair(migrationStatus)
      ? migrationStatus.migration035Sql
      : migrationStatus?.migration017Sql ||
        migrationStatus?.migration014Sql ||
        migrationStatus?.migration002Sql ||
        ''

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

      <div className="mb-8 rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">Schema Migrations</h2>
            <p className="text-sm text-gray-500">
              permit_requests, equipment_profiles, and rig_configurations columns
            </p>
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
          migrationStatus.authRequired || migrationStatus.adminAccessDenied ? (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">
              <strong>Admin access required</strong>
              <div className="mt-1 text-sm">{migrationStatus.error}</div>
            </div>
          ) : !migrationStatus.hasAdmin ? (
            <div className="rounded-lg bg-gray-100 border border-gray-200 p-4 text-gray-700">
              <strong>Service role not configured</strong>
              <div className="mt-1 text-sm">
                Add <code>SUPABASE_SERVICE_ROLE_KEY</code> to <code>.env.local</code> on the server to
                enable schema checks.
              </div>
            </div>
          ) : migrationStatus.columnsExist ? (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-green-700">
              ✅ <strong>All required columns present</strong>
              <div className="mt-1 text-sm">
                Includes permit_requests route fields, equipment_profiles license plates, and
                rig_configurations.is_default.
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
              <div className="mb-3 text-amber-700">
                <strong>Migration required</strong>
                {migrationStatus.missingColumns && migrationStatus.missingColumns.length > 0 ? (
                  <span> — missing columns:</span>
                ) : (
                  <span> — schema check reported gaps.</span>
                )}
              </div>
              {migrationStatus.missingColumns && migrationStatus.missingColumns.length > 0 && (
                <ul className="mb-4 list-inside list-disc text-sm text-amber-800">
                  {migrationStatus.missingColumns.map((col) => (
                    <li key={col}>{col}</li>
                  ))}
                </ul>
              )}

              {carrierConnectionInvitesNeedsRepair(migrationStatus) && (
                <div className="mb-4 rounded border border-amber-300 bg-amber-100/60 p-3 text-sm text-amber-900">
                  <strong>Carriers page:</strong> <code>carrier_connection_invites</code> is missing
                  or inconclusive. Prefer full Apply Migration, or run targeted{' '}
                  <code>migration035Sql</code> /{' '}
                  <code className="whitespace-nowrap">node scripts/apply-migration-035.mjs</code>.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={applyMigration}
                  disabled={applying}
                  className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-emerald-300"
                >
                  {applying ? 'Applying...' : 'Apply Migration'}
                </button>
                <button
                  onClick={copyMigrationSql}
                  className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-700"
                >
                  Copy SQL &amp; Show Instructions
                </button>
                {carrierConnectionInvitesNeedsRepair(migrationStatus) &&
                  migrationStatus.migration035Sql && (
                    <button
                      onClick={copyCarrierConnectionInvitesSql}
                      className="rounded-lg border border-amber-600 bg-white px-5 py-2.5 text-sm font-medium text-amber-800 hover:bg-amber-50"
                    >
                      Copy 035 (carrier invites)
                    </button>
                  )}
              </div>
              <p className="mt-2 text-xs text-amber-600">
                Live apply requires DATABASE_URL or SUPABASE_DB_PASSWORD on the server. Otherwise copy
                SQL and run in Supabase Dashboard → SQL Editor.
              </p>
              {migrationStatus.needsManualRun && migrationStatus.applied === false && migrationStatus.message && (
                <p className="mt-2 text-xs text-amber-700">{migrationStatus.message}</p>
              )}
            </div>
          )
        ) : (
          <p className="text-gray-500">Click &quot;Refresh Status&quot; to check the current schema.</p>
        )}

        {showPhase1SqlTools && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Phase 1 SQL tools</h3>
            <p className="mt-1 text-xs text-slate-600">
              Always available when admin schema check succeeds (healthy or needs migration). Run in
              Supabase SQL Editor if targeted apply scripts are not used.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyMigration037Sql}
                className="rounded-lg border border-slate-600 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Copy 037 (Phase 1b RLS)
              </button>
              <button
                type="button"
                onClick={copyMigration038Sql}
                className="rounded-lg border border-slate-600 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Copy 038 (self-Clerk PE)
              </button>
              <button
                type="button"
                onClick={copyMigration039Sql}
                className="rounded-lg border border-slate-600 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Copy 039 (self-INSERT Clerk)
              </button>
              <button
                type="button"
                onClick={copyMigration040Sql}
                className="rounded-lg border border-slate-600 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Copy 040 (invite UPDATE PE)
              </button>
              <button
                type="button"
                onClick={copyMigration041Sql}
                className="rounded-lg border border-slate-600 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Copy 041 (session match PE)
              </button>
            </div>
          </div>
        )}

        {displaySql && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer font-medium text-gray-600">Show migration SQL from API</summary>
            <pre className="mt-2 overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100">{displaySql}</pre>
          </details>
        )}
      </div>

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
            onClick={copyMigrationSql}
            className="rounded-lg border p-4 text-left hover:bg-gray-50"
          >
            <div className="font-medium">📋 Copy consolidated migration SQL</div>
            <div className="text-sm text-gray-500">Includes rig-builder columns (017) for manual execution</div>
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