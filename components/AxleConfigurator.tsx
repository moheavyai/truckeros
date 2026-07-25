'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  AXLE_OPTIMIZER_STATE_CODES,
  TANDEM_MAX_IN,
  calculateAxleGroups,
  defaultFiveAxleClass8,
  restoreSelectedStatesFromSaved,
  type AxleInput,
  type AxlePhysicalType,
  type ComplianceStatus,
  type SpacingGroupType,
} from '@/lib/axleGroupCalculator'

/** Match API parseAxleInputs limits. */
const MAX_AXLES = 20
const MAX_POSITION_IN = 2400

/** Mobile-first contrast — matches equipment / permit-test patterns. */
const fieldControlClass =
  'border border-gray-500 sm:border-gray-300 text-gray-900 placeholder:text-gray-500 bg-white'
const inputClass = `${fieldControlClass} rounded-lg p-2 w-full text-sm min-h-[44px]`
const buttonSecondaryClass =
  'inline-flex items-center justify-center min-h-[44px] px-4 py-2 border border-gray-500 sm:border-gray-300 bg-white text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 touch-manipulation'
const buttonPrimaryClass =
  'inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50 touch-manipulation'
const cardClass = 'bg-white border border-gray-300 sm:border-gray-200 rounded-2xl p-4 sm:p-5'
const mutedTextClass = 'text-gray-600 sm:text-gray-500'
const bodyTextClass = 'text-gray-700 sm:text-gray-600'
const checkboxClass = 'h-4 w-4 rounded accent-emerald-700 border-gray-500 sm:border-gray-300'

const GROUP_COLORS: Record<SpacingGroupType, string> = {
  single: '#0ea5e9',
  tandem: '#6366f1',
  tridem: '#d97706',
  quad: '#db2777',
  spread: '#10b981',
}

const STATUS_STYLES: Record<ComplianceStatus, string> = {
  green: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  yellow: 'bg-amber-100 text-amber-950 border-amber-300',
  red: 'bg-red-100 text-red-900 border-red-300',
}

const TYPE_OPTIONS: AxlePhysicalType[] = ['steer', 'drive', 'trailer', 'lift']

type SavedConfigSummary = {
  id: string
  name: string
  axles: AxleInput[]
  state_rules?: Record<string, unknown> | null
  updated_at?: string | null
  created_at?: string | null
}

function newAxleId(): string {
  return `ax-${Math.random().toString(36).slice(2, 9)}`
}

function formatLbs(n: number): string {
  return `${Math.round(n).toLocaleString()} lbs`
}

export interface AxleConfiguratorProps {
  /** Optional initial axles (defaults to 5-axle Class 8). */
  initialAxles?: AxleInput[]
  initialStates?: string[]
  initialName?: string
  className?: string
}

/**
 * Interactive spacing-based axle group optimizer UI.
 * Drag axles on the SVG rail, edit inches/loads, multi-select states, save/load via API.
 */
export default function AxleConfigurator({
  initialAxles,
  initialStates = ['MO'],
  initialName = '5-axle Class 8',
  className = '',
}: AxleConfiguratorProps) {
  const [axles, setAxles] = useState<AxleInput[]>(
    () => initialAxles ?? defaultFiveAxleClass8()
  )
  const [states, setStates] = useState<string[]>(() =>
    initialStates.map((s) => s.toUpperCase())
  )
  const [name, setName] = useState(initialName)
  const [configId, setConfigId] = useState<string | null>(null)
  const [savedConfigs, setSavedConfigs] = useState<SavedConfigSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const dragIdRef = useRef<string | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const captureElRef = useRef<Element | null>(null)

  const analysis = useMemo(
    () => calculateAxleGroups({ axles, states }),
    [axles, states]
  )

  const maxPos = useMemo(() => {
    const m = Math.max(120, ...axles.map((a) => a.position_inches), 600)
    return Math.ceil(m / 60) * 60 + 60
  }, [axles])

  const VIEW_W = 920
  const VIEW_H = 160
  const PAD = 40
  const toX = useCallback(
    (inches: number) => PAD + (inches / maxPos) * (VIEW_W - PAD * 2),
    [maxPos]
  )
  const fromClientX = useCallback(
    (clientX: number) => {
      const svg = svgRef.current
      if (!svg) return 0
      const rect = svg.getBoundingClientRect()
      const x = ((clientX - rect.left) / rect.width) * VIEW_W
      const inches = ((x - PAD) / (VIEW_W - PAD * 2)) * maxPos
      return Math.max(0, Math.min(maxPos, Math.round(inches)))
    },
    [maxPos]
  )

  const refreshSavedList = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await fetch('/api/axle-optimize')
      const data = await res.json()
      if (res.ok && Array.isArray(data.configs)) {
        setSavedConfigs(data.configs as SavedConfigSummary[])
      }
    } catch {
      // non-fatal — list may be empty before migration
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSavedList()
  }, [refreshSavedList])

  const updateAxle = (id: string, patch: Partial<AxleInput>) => {
    setAxles((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a
        const next = { ...a, ...patch }
        if (patch.position_inches != null) {
          next.position_inches = Math.max(
            0,
            Math.min(MAX_POSITION_IN, Number(patch.position_inches) || 0)
          )
        }
        if (patch.current_load_lbs != null) {
          next.current_load_lbs = Math.max(
            0,
            Math.min(100_000, Number(patch.current_load_lbs) || 0)
          )
        }
        return next
      })
    )
  }

  const removeAxle = (id: string) => {
    setAxles((prev) => (prev.length <= 1 ? prev : prev.filter((a) => a.id !== id)))
  }

  const addAxle = () => {
    if (axles.length >= MAX_AXLES) {
      setSaveError(`Maximum ${MAX_AXLES} axles supported.`)
      return
    }
    const last = [...axles].sort((a, b) => a.position_inches - b.position_inches).at(-1)
    const pos = Math.min(MAX_POSITION_IN, (last?.position_inches ?? 0) + 54)
    setAxles((prev) => [
      ...prev,
      {
        id: newAxleId(),
        position_inches: pos,
        type: 'trailer',
        tire_count: 4,
        current_load_lbs: 0,
        lifted: false,
      },
    ])
  }

  const toggleState = (code: string) => {
    setStates((prev) =>
      prev.includes(code) ? prev.filter((s) => s !== code) : [...prev, code]
    )
  }

  const loadConfig = (cfg: SavedConfigSummary) => {
    if (!Array.isArray(cfg.axles) || cfg.axles.length === 0) {
      setSaveError('Saved config has no axles')
      return
    }
    setAxles(
      cfg.axles.map((a, i) => ({
        id: String(a.id ?? `ax${i + 1}`),
        position_inches: Number(a.position_inches) || 0,
        type: (['steer', 'drive', 'trailer', 'lift'].includes(String(a.type))
          ? a.type
          : 'trailer') as AxlePhysicalType,
        tire_count: a.tire_count ?? null,
        current_load_lbs: Math.max(0, Number(a.current_load_lbs) || 0),
        lifted: a.lifted === true,
      }))
    )
    setName(cfg.name || 'Saved config')
    setConfigId(cfg.id)
    // Restore corridor selection: _selected_states preferred; empty = federal-only (no chips).
    // Never expand US-only / empty meta into every DEFAULT_STATE_RULES key.
    setStates(restoreSelectedStatesFromSaved(cfg.state_rules, AXLE_OPTIMIZER_STATE_CODES))
    setSaveMsg(
      `Loaded “${cfg.name || cfg.id}”. Further saves update this config.` +
        (restoreSelectedStatesFromSaved(cfg.state_rules, AXLE_OPTIMIZER_STATE_CODES).length === 0
          ? ' (federal baseline — no corridor states selected).'
          : '')
    )
    setSaveError(null)
  }

  const deleteConfig = async (id: string) => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/axle-optimize?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveError(data.error || 'Delete failed')
        return
      }
      if (configId === id) {
        setConfigId(null)
        setSaveMsg('Deleted current config (local layout kept).')
      } else {
        setSaveMsg('Configuration deleted.')
      }
      await refreshSavedList()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  const endDrag = useCallback((e?: ReactPointerEvent | PointerEvent) => {
    if (captureElRef.current && e && 'pointerId' in e) {
      try {
        captureElRef.current.releasePointerCapture?.(e.pointerId)
      } catch {
        // already released
      }
    }
    captureElRef.current = null
    dragIdRef.current = null
    setDragId(null)
  }, [])

  const onPointerDownAxle = (id: string, e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as Element
    try {
      target.setPointerCapture?.(e.pointerId)
      captureElRef.current = target
    } catch {
      captureElRef.current = null
    }
    dragIdRef.current = id
    setDragId(id)
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const id = dragIdRef.current
    if (!id) return
    const inches = fromClientX(e.clientX)
    updateAxle(id, { position_inches: inches })
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    if (!dragIdRef.current) return
    endDrag(e)
  }

  // Do not end drag on pointer leave — pointer capture keeps events on the element.
  // Only clear if we somehow lost capture without pointerup.
  const onPointerCancel = (e: ReactPointerEvent) => {
    endDrag(e)
  }

  const handleSave = async (persist: boolean) => {
    setSaving(true)
    setSaveMsg(null)
    setSaveError(null)
    if (axles.length === 0) {
      setSaveError('At least one axle is required.')
      setSaving(false)
      return
    }
    if (axles.length > MAX_AXLES) {
      setSaveError(`Maximum ${MAX_AXLES} axles supported.`)
      setSaving(false)
      return
    }
    const clamped = axles.map((a) => ({
      ...a,
      position_inches: Math.max(0, Math.min(MAX_POSITION_IN, a.position_inches)),
      current_load_lbs: Math.max(0, Math.min(100_000, a.current_load_lbs)),
    }))
    if (clamped.some((a, i) => a.position_inches !== axles[i].position_inches)) {
      setAxles(clamped)
    }
    try {
      const res = await fetch('/api/axle-optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          axles: clamped,
          // Empty states = federal-only; API persists _selected_states without expanding corridor
          states,
          name,
          save: persist,
          id: configId,
          // organization_id intentionally omitted — API resolves from membership
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveError(data.error || 'Request failed')
        return
      }
      if (persist) {
        if (data.saved?.id) setConfigId(String(data.saved.id))
        setSaveMsg(data.saved ? 'Configuration saved.' : 'Analyzed (save may have failed).')
        await refreshSavedList()
      } else {
        setSaveMsg('Analysis refreshed via API.')
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  const groupColorForAxle = (axleId: string): string => {
    const g = analysis.groups.find((gr) => gr.axle_ids.includes(axleId))
    return g ? GROUP_COLORS[g.type] : '#374151'
  }

  return (
    <div className={`space-y-5 ${className}`}>
      {/* Saved configs */}
      <div className={`${cardClass} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Saved configs</h2>
          <button
            type="button"
            className={buttonSecondaryClass}
            onClick={() => void refreshSavedList()}
            disabled={listLoading}
          >
            {listLoading ? 'Loading…' : 'Refresh list'}
          </button>
        </div>
        {listLoading && savedConfigs.length === 0 ? (
          <p className={`text-sm ${mutedTextClass}`}>Loading saved layouts…</p>
        ) : savedConfigs.length === 0 ? (
          <p className={`text-sm ${mutedTextClass}`}>
            No saved configs yet. Use Save Config to persist this layout.
          </p>
        ) : (
          <ul className="space-y-2">
            {savedConfigs.map((cfg) => (
              <li
                key={cfg.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-300 sm:border-gray-200 px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {cfg.name || 'Untitled'}
                    {configId === cfg.id ? (
                      <span className="ml-2 text-xs font-semibold text-emerald-800">loaded</span>
                    ) : null}
                  </div>
                  <div className={`text-[11px] ${mutedTextClass}`}>
                    {(cfg.axles?.length ?? 0)} axles
                    {cfg.updated_at
                      ? ` · ${new Date(cfg.updated_at).toLocaleString()}`
                      : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className={buttonSecondaryClass}
                  onClick={() => loadConfig(cfg)}
                >
                  Load
                </button>
                <button
                  type="button"
                  className={buttonSecondaryClass}
                  disabled={saving}
                  onClick={() => void deleteConfig(cfg.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Header controls */}
      <div className={`${cardClass} space-y-4`}>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <label className="flex-1 block">
            <span className="text-xs font-semibold text-gray-600 sm:text-gray-500">Config name</span>
            <input
              className={`${inputClass} mt-1`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              aria-label="Configuration name"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonSecondaryClass}
              onClick={addAxle}
              disabled={axles.length >= MAX_AXLES}
              title={axles.length >= MAX_AXLES ? `Max ${MAX_AXLES} axles` : 'Add axle'}
            >
              + Add axle
            </button>
            <button
              type="button"
              className={buttonSecondaryClass}
              onClick={() => {
                setAxles(defaultFiveAxleClass8())
                setConfigId(null)
                setName('5-axle Class 8')
                setSaveMsg('Reset to default 5-axle (new config on next save).')
              }}
            >
              Reset 5-axle
            </button>
            <button
              type="button"
              className={buttonPrimaryClass}
              disabled={saving}
              onClick={() => void handleSave(true)}
            >
              {saving ? 'Saving…' : configId ? 'Update Config' : 'Save Config'}
            </button>
          </div>
        </div>
        {configId && (
          <p className={`text-xs ${mutedTextClass}`}>
            Editing saved id <code className="text-gray-800">{configId}</code> — save updates this row.
          </p>
        )}

        {/* Multi-select states */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-gray-600 sm:text-gray-500">
              Corridor states
            </span>
            <Tooltip
              label="Why these states?"
              text="Defaults cover primary TruckerOS corridors (MO/KS/IL/TN/TX/FL/OK/AL/MS). Multi-state runs take the most restrictive legal cap per group. Deselect all for federal Interstate baseline only."
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {AXLE_OPTIMIZER_STATE_CODES.map((code) => {
              const on = states.includes(code)
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => toggleState(code)}
                  className={`min-h-[40px] min-w-[48px] px-3 rounded-lg text-sm font-semibold border touch-manipulation ${
                    on
                      ? 'bg-black text-white border-black'
                      : 'bg-white text-gray-800 border-gray-500 sm:border-gray-300'
                  }`}
                  aria-pressed={on}
                >
                  {code}
                </button>
              )
            })}
          </div>
          {states.length === 0 && (
            <p className={`text-xs mt-2 ${mutedTextClass}`}>
              No corridor states selected — analysis uses federal Interstate defaults only.
            </p>
          )}
        </div>

        {/* Voice placeholder */}
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-gray-400 sm:border-gray-300 bg-gray-50 px-3 py-2">
          <button
            type="button"
            disabled
            className="min-h-[40px] px-3 rounded-lg text-sm font-medium bg-gray-200 text-gray-500 cursor-not-allowed"
            title="Voice input — future ELD integration"
          >
            🎤 Voice (coming soon)
          </button>
          <span className={`text-xs ${mutedTextClass}`}>
            Placeholder for future ELD / hands-free axle load entry.
          </span>
        </div>

        {(saveMsg || saveError) && (
          <p
            className={`text-sm font-medium ${saveError ? 'text-red-700' : 'text-emerald-800'}`}
            role="status"
          >
            {saveError || saveMsg}
          </p>
        )}
      </div>

      {/* SVG diagram */}
      <div className={cardClass}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Axle layout (drag to move)</h2>
          <Tooltip
            label="Why 96 inches?"
            text="Federal tandem definition: axles spaced more than 40&quot; and at most 96&quot; center-to-center form a tandem (typically 34,000 lbs Interstate). Beyond 96&quot; they are separate singles (weight win: 20k+20k)."
          />
        </div>
        <div className="overflow-x-auto -mx-1 px-1">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="w-full min-w-[320px] h-auto select-none touch-none"
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            role="img"
            aria-label="Interactive axle spacing diagram"
          >
            <line
              x1={PAD}
              y1={90}
              x2={VIEW_W - PAD}
              y2={90}
              stroke="#9ca3af"
              strokeWidth={4}
              strokeLinecap="round"
            />
            <rect x={PAD} y={55} width={Math.max(40, toX(220) - PAD)} height={28} rx={4} fill="#111827" opacity={0.12} />
            <text x={PAD + 8} y={73} className="fill-gray-600" fontSize={11}>
              Tractor
            </text>
            <rect
              x={toX(Math.min(maxPos * 0.45, 400))}
              y={58}
              width={Math.max(60, VIEW_W - PAD - toX(Math.min(maxPos * 0.45, 400)))}
              height={24}
              rx={4}
              fill="#374151"
              opacity={0.1}
            />

            {Array.from({ length: Math.floor(maxPos / 60) + 1 }, (_, i) => i * 60).map((inch) => (
              <g key={inch}>
                <line
                  x1={toX(inch)}
                  y1={90}
                  x2={toX(inch)}
                  y2={98}
                  stroke="#d1d5db"
                  strokeWidth={1}
                />
                <text
                  x={toX(inch)}
                  y={112}
                  textAnchor="middle"
                  fontSize={9}
                  className="fill-gray-500"
                >
                  {inch}&quot;
                </text>
              </g>
            ))}

            {analysis.groups.map((g) => {
              if (g.axle_indexes.length === 0) return null
              const members = axles
                .filter((a) => g.axle_ids.includes(a.id) && !a.lifted)
                .sort((a, b) => a.position_inches - b.position_inches)
              if (members.length === 0) return null
              const x1 = toX(members[0].position_inches)
              const x2 = toX(members[members.length - 1].position_inches)
              return (
                <rect
                  key={g.id}
                  x={Math.min(x1, x2) - 14}
                  y={70}
                  width={Math.max(28, Math.abs(x2 - x1) + 28)}
                  height={40}
                  rx={8}
                  fill={GROUP_COLORS[g.type]}
                  opacity={0.15}
                />
              )
            })}

            {axles.map((a) => {
              const x = toX(a.position_inches)
              const color = a.lifted ? '#9ca3af' : groupColorForAxle(a.id)
              return (
                <g
                  key={a.id}
                  transform={`translate(${x}, 90)`}
                  onPointerDown={(e) => onPointerDownAxle(a.id, e)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                  style={{ cursor: dragId === a.id ? 'grabbing' : 'grab' }}
                  role="slider"
                  aria-label={`Axle ${a.id} at ${a.position_inches} inches`}
                  aria-valuemin={0}
                  aria-valuemax={maxPos}
                  aria-valuenow={a.position_inches}
                >
                  <line x1={0} y1={-28} x2={0} y2={18} stroke={color} strokeWidth={3} />
                  <circle r={14} fill={color} stroke="#111827" strokeWidth={1.5} opacity={a.lifted ? 0.4 : 1} />
                  <circle r={5} fill="#fff" />
                  <text y={36} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-gray-800">
                    {a.position_inches}&quot;
                  </text>
                  <text y={-36} textAnchor="middle" fontSize={9} className="fill-gray-600">
                    {a.type}
                    {a.lifted ? ' ↑' : ''}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
        <p className={`text-xs mt-2 ${mutedTextClass}`}>
          Drag axle hubs horizontally. Use sliders below for precise inches. Lifted axles are excluded from groups.
        </p>
      </div>

      {/* Per-axle editors */}
      <div className={cardClass}>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Axles</h2>
        <div className="space-y-3">
          {[...axles]
            .sort((a, b) => a.position_inches - b.position_inches)
            .map((a) => (
              <div
                key={a.id}
                className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end border border-gray-300 sm:border-gray-200 rounded-xl p-3"
              >
                <label className="block sm:col-span-1">
                  <span className="text-[11px] text-gray-600 sm:text-gray-500">Type</span>
                  <select
                    className={`${inputClass} mt-0.5`}
                    value={a.type}
                    onChange={(e) =>
                      updateAxle(a.id, { type: e.target.value as AxlePhysicalType })
                    }
                  >
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-[11px] text-gray-600 sm:text-gray-500">
                    Position (inches)
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={maxPos}
                    value={a.position_inches}
                    onChange={(e) =>
                      updateAxle(a.id, { position_inches: Number(e.target.value) })
                    }
                    className="w-full mt-2 accent-black"
                  />
                  <input
                    type="number"
                    className={`${inputClass} mt-1`}
                    value={a.position_inches}
                    min={0}
                    max={MAX_POSITION_IN}
                    onChange={(e) =>
                      updateAxle(a.id, {
                        position_inches: Number(e.target.value) || 0,
                      })
                    }
                  />
                </label>
                <label className="block sm:col-span-1">
                  <span className="text-[11px] text-gray-600 sm:text-gray-500">Load (lbs)</span>
                  <input
                    type="number"
                    className={`${inputClass} mt-0.5`}
                    value={a.current_load_lbs}
                    min={0}
                    max={100000}
                    onChange={(e) =>
                      updateAxle(a.id, {
                        current_load_lbs: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                  />
                </label>
                <label className="flex items-center gap-2 min-h-[44px] sm:col-span-1">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={!!a.lifted}
                    onChange={(e) => updateAxle(a.id, { lifted: e.target.checked })}
                  />
                  <span className="text-sm text-gray-800">Lift up</span>
                </label>
                <button
                  type="button"
                  className={`${buttonSecondaryClass} sm:col-span-1`}
                  onClick={() => removeAxle(a.id)}
                  disabled={axles.length <= 1}
                >
                  Remove
                </button>
              </div>
            ))}
        </div>
      </div>

      {/* Dashboard results */}
      <div className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Group analysis</h2>
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border ${STATUS_STYLES[analysis.overall_compliance]}`}
          >
            Overall: {analysis.overall_compliance.toUpperCase()}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Stat label="GVW" value={formatLbs(analysis.gvw_lbs)} />
          <Stat label="Gross legal" value={formatLbs(analysis.gross_legal_lbs)} />
          <Stat label="Σ group legal" value={formatLbs(analysis.total_group_legal_lbs)} />
          <Stat label="Violations" value={String(analysis.violation_count)} />
        </div>
        <p className={`text-xs mb-3 ${mutedTextClass}`}>
          Yellow / “permit” soft band is ~1.25× legal — a planner estimate only, not an official
          state permit limit. Verify with current statutes before locking a package.
        </p>
        {analysis.vehicle_bridge_formula?.applicable && (
          <p className={`text-xs mb-3 ${bodyTextClass}`}>
            Vehicle bridge: {analysis.vehicle_bridge_formula.formula}
          </p>
        )}
        {analysis.worst_bridge_window &&
          analysis.worst_bridge_window.compliance_status !== 'green' && (
            <div
              className={`mb-3 rounded-xl border p-3 text-xs ${STATUS_STYLES[analysis.worst_bridge_window.compliance_status]}`}
            >
              <strong>Worst bridge window:</strong>{' '}
              {analysis.worst_bridge_window.axle_ids.join('→')} · load{' '}
              {formatLbs(analysis.worst_bridge_window.load_lbs)} vs W{' '}
              {formatLbs(analysis.worst_bridge_window.bridge.W_lbs)} (
              {analysis.bridge_window_violations.length} window
              {analysis.bridge_window_violations.length === 1 ? '' : 's'} over legal)
            </div>
          )}

        <div className="space-y-2">
          {analysis.groups.map((g) => (
            <div
              key={g.id}
              className={`rounded-xl border p-3 ${STATUS_STYLES[g.compliance_status]}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-sm">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full mr-2"
                    style={{ background: GROUP_COLORS[g.type] }}
                  />
                  {g.id} · {g.type}
                  {g.limiting_state ? ` · limit ${g.limiting_state}` : ''}
                </div>
                <div className="text-xs font-medium">
                  {formatLbs(g.current_load_lbs)} / legal {formatLbs(g.max_legal_lbs)}
                  {' · '}permit {formatLbs(g.max_permitted_lbs)}
                </div>
              </div>
              <p className={`text-xs mt-1 ${bodyTextClass}`}>
                Axles: {g.axle_ids.join(', ')} · outer span {g.outer_span_inches.toFixed(0)}&quot;
                {g.bridge_formula?.applicable
                  ? ` · bridge ${formatLbs(g.bridge_formula.W_lbs)}`
                  : ''}
              </p>
              {g.optimization_tips.length > 0 && (
                <ul className="mt-1 text-xs list-disc pl-4 space-y-0.5">
                  {g.optimization_tips.slice(0, 3).map((t) => (
                    <li key={t.slice(0, 40)}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {analysis.optimization_tips.length > 0 && (
          <div className="mt-4 rounded-xl bg-sky-50 border border-sky-200 p-3">
            <h3 className="text-xs font-semibold text-sky-950 mb-1">Optimization tips</h3>
            <ul className="text-xs text-sky-900 list-disc pl-4 space-y-1">
              {analysis.optimization_tips.map((t) => (
                <li key={t.slice(0, 48)}>{t}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonSecondaryClass}
            onClick={() => void handleSave(false)}
            disabled={saving}
          >
            Re-run via API
          </button>
          <Tooltip
            label="Federal tandem"
            text={`Tandem max spacing is ${TANDEM_MAX_IN} inches. Spreading past that unlocks two single-axle limits (often a weight win on OSOW).`}
          />
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-300 sm:border-gray-200 bg-gray-50 px-3 py-2">
      <div className={`text-[11px] ${mutedTextClass}`}>{label}</div>
      <div className="text-sm font-semibold text-gray-900">{value}</div>
    </div>
  )
}

function Tooltip({ label, text }: { label: string; text: string }) {
  return (
    <details className="relative group inline-block">
      <summary className="list-none cursor-help text-xs font-medium text-sky-800 underline decoration-dotted underline-offset-2 min-h-[32px] inline-flex items-center">
        {label}
      </summary>
      <div className="absolute z-20 left-0 mt-1 w-64 sm:w-72 p-3 text-xs text-gray-800 bg-white border border-gray-300 rounded-xl shadow-lg">
        {text}
      </div>
    </details>
  )
}
