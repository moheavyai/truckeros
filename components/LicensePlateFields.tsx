'use client'

import { US_STATE_OPTIONS } from '@/lib/us-states'

export type LicensePlateFieldsProps = {
  plate?: string | null
  state?: string | null
  onPlateChange: (value: string) => void
  onStateChange: (value: string) => void
  /** Stable prefix for input ids (e.g. "tractor-edit") — avoids remount-related focus loss */
  idPrefix?: string
}

/** Mobile-first contrast: stronger borders/text on small screens; softer from sm: up */
const fieldControlClass =
  'border border-gray-500 sm:border-gray-300 text-gray-900 placeholder:text-gray-500 bg-white'
const inputClass = `${fieldControlClass} rounded p-1.5 w-full mt-0.5 text-sm`
const fieldLabelTinyClass = 'text-[11px] text-gray-600 sm:text-gray-500'

export default function LicensePlateFields({
  plate,
  state,
  onPlateChange,
  onStateChange,
  idPrefix = 'license-plate',
}: LicensePlateFieldsProps) {
  const plateId = `${idPrefix}-plate`
  const stateId = `${idPrefix}-state`

  return (
    <>
      <div>
        <label htmlFor={plateId} className={fieldLabelTinyClass}>
          License Plate
        </label>
        <input
          id={plateId}
          type="text"
          value={plate ?? ''}
          onChange={(e) => onPlateChange(e.target.value.toUpperCase())}
          placeholder="e.g. ABC1234"
          maxLength={12}
          className={inputClass}
          autoCapitalize="characters"
        />
      </div>
      <div>
        <label htmlFor={stateId} className={fieldLabelTinyClass}>
          Plate State
        </label>
        <select
          id={stateId}
          value={state ?? ''}
          onChange={(e) => onStateChange(e.target.value)}
          className={`${inputClass} min-h-[34px]`}
        >
          <option value="">—</option>
          {US_STATE_OPTIONS.map(({ code, name }) => (
            <option key={code} value={code}>
              {code} — {name}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}