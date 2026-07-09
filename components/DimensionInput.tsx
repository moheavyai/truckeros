'use client'

import { useState, useEffect, useRef } from 'react'
import { parseDimensionInput, formatDimensionDisplay } from '@/lib/parse-dimension'

type DimensionInputProps = {
  value: number | string
  onChange: (feetDecimal: number, display: string) => void
  label?: string
  placeholder?: string
  className?: string
  id?: string
}

export default function DimensionInput({
  value,
  onChange,
  label,
  placeholder = `e.g. 12' 6" or 144"`,
  className = '',
  id,
}: DimensionInputProps) {
  const numeric = typeof value === 'number' ? value : parseFloat(String(value)) || 0
  const [text, setText] = useState(numeric > 0 ? formatDimensionDisplay(numeric) : '')
  const focusedRef = useRef(false)
  const lastCommittedRef = useRef(numeric)

  // Sync display from parent only when value changes externally (not while user is typing).
  useEffect(() => {
    if (focusedRef.current) return
    const n = typeof value === 'number' ? value : parseFloat(String(value)) || 0
    if (Math.abs(n - lastCommittedRef.current) < 0.001) return
    lastCommittedRef.current = n
    setText(n > 0 ? formatDimensionDisplay(n) : '')
  }, [value])

  const commit = (raw: string) => {
    const parsed = parseDimensionInput(raw)
    if (parsed) {
      const display = formatDimensionDisplay(parsed.feetDecimal)
      setText(display)
      lastCommittedRef.current = parsed.feetDecimal
      onChange(parsed.feetDecimal, display)
      return
    }
    const num = parseFloat(raw)
    if (!Number.isNaN(num) && num > 0) {
      const display = formatDimensionDisplay(num)
      setText(display)
      lastCommittedRef.current = num
      onChange(num, display)
    }
  }

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="block text-[10px] text-gray-500 mb-0.5">
          {label}
        </label>
      )}
      <input
        id={id}
        type="text"
        value={text}
        placeholder={placeholder}
        onFocus={() => {
          focusedRef.current = true
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          focusedRef.current = false
          commit(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit((e.target as HTMLInputElement).value)
          }
        }}
        className="border p-1.5 rounded w-full text-sm font-mono"
      />
    </div>
  )
}