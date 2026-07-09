'use client'

/**
 * Manual feet input for load overhangs — no auto-formatting or parent-driven resync.
 * Values only change when the user edits the field.
 */

type OverhangFeetInputProps = {
  label: string
  value: number
  onChange: (feet: number) => void
  id?: string
  sublabel?: string
}

export default function OverhangFeetInput({
  label,
  value,
  onChange,
  id,
  sublabel,
}: OverhangFeetInputProps) {
  const display =
    Number.isFinite(value) && value > 0 ? String(value) : value === 0 ? '0' : ''

  return (
    <div>
      <label htmlFor={id} className="block text-xs text-gray-600">
        {label}
        {sublabel ? (
          <span className="text-amber-600 text-[9px] ml-1">{sublabel}</span>
        ) : null}
      </label>
      <input
        id={id}
        type="number"
        step="0.5"
        min="0"
        value={display}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') {
            onChange(0)
            return
          }
          const n = parseFloat(raw)
          if (Number.isFinite(n) && n >= 0) onChange(n)
        }}
        className="border p-1.5 rounded w-full text-sm font-mono"
      />
    </div>
  )
}