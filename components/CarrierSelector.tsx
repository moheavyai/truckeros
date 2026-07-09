'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { organizationDisplayName } from '@/lib/organization-context'
import { carrierSummaryLabel, filterAccessibleCarriers } from '@/lib/service-mode-scope'
import type { AccessibleCarrier } from '@/types/organization'

type CarrierSelectorProps = {
  carriers: AccessibleCarrier[]
  activeOrganizationId: string | null
  activeOrganization: AccessibleCarrier | null
  loading?: boolean
  onSelect: (organizationId: string) => void
}

export default function CarrierSelector({
  carriers,
  activeOrganizationId,
  activeOrganization,
  loading = false,
  onSelect,
}: CarrierSelectorProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filteredCarriers = useMemo(
    () => filterAccessibleCarriers(carriers, query),
    [carriers, query]
  )

  useEffect(() => {
    setHighlightIndex(0)
  }, [query, open])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (carrier: AccessibleCarrier) => {
    onSelect(carrier.id)
    setQuery('')
    setOpen(false)
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setOpen(true)
      return
    }

    if (event.key === 'Escape') {
      setOpen(false)
      setQuery('')
      return
    }

    if (!open || filteredCarriers.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightIndex((index) => (index + 1) % filteredCarriers.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightIndex((index) => (index - 1 + filteredCarriers.length) % filteredCarriers.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const carrier = filteredCarriers[highlightIndex]
      if (carrier) handleSelect(carrier)
    }
  }

  if (loading) {
    return <span className="text-gray-500 text-sm">Loading carriers…</span>
  }

  if (carriers.length === 0) {
    return (
      <span className="text-gray-700 text-sm">
        No carriers linked.{' '}
        <a href="/carriers" className="text-blue-700 hover:text-blue-900 font-medium underline-offset-2 hover:underline">
          Manage carriers
        </a>
      </span>
    )
  }

  return (
    <div ref={containerRef} className="flex flex-wrap items-center gap-2 min-w-[220px]">
      {activeOrganization && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-900"
          title={carrierSummaryLabel(activeOrganization)}
        >
          <span className="truncate max-w-[200px]">{organizationDisplayName(activeOrganization)}</span>
          {activeOrganization.usdot_number?.trim() && (
            <span className="text-blue-700/80">USDOT {activeOrganization.usdot_number.trim()}</span>
          )}
        </span>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleInputKeyDown}
          placeholder={activeOrganization ? 'Switch carrier…' : 'Search carriers…'}
          className="border border-gray-300 bg-white rounded-lg px-3 py-1.5 text-sm w-48 sm:w-56 focus:outline-none focus:ring-2 focus:ring-black/10"
          aria-label="Search carriers"
          aria-expanded={open}
          aria-haspopup="listbox"
        />

        {open && (
          <ul
            role="listbox"
            className="absolute right-0 z-50 mt-1 max-h-56 w-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg text-sm"
          >
            {filteredCarriers.length === 0 ? (
              <li className="px-3 py-2 text-gray-500">No carriers match your search.</li>
            ) : (
              filteredCarriers.map((carrier, index) => {
                const selected = carrier.id === activeOrganizationId
                const highlighted = index === highlightIndex
                return (
                  <li key={carrier.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setHighlightIndex(index)}
                      onClick={() => handleSelect(carrier)}
                      className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${
                        selected || highlighted ? 'bg-gray-100 font-medium' : ''
                      }`}
                    >
                      <div className="font-medium text-gray-900">{organizationDisplayName(carrier)}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {[
                          carrier.usdot_number?.trim() ? `USDOT ${carrier.usdot_number.trim()}` : null,
                          carrier.membership_role?.trim(),
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'Carrier'}
                      </div>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        )}
      </div>

      <a
        href="/carriers"
        className="text-gray-600 hover:text-black text-xs font-medium underline-offset-2 hover:underline whitespace-nowrap"
      >
        Manage carriers
      </a>
    </div>
  )
}