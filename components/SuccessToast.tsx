'use client'

import { useEffect } from 'react'

export interface SuccessToastProps {
  message: string | null
  onDismiss: () => void
  /** Auto-hide after ms (default 3200). */
  durationMs?: number
}

/**
 * Calm success notice — replaces browser alert() for saves and confirmations.
 * Fixed bottom-center on mobile; non-blocking.
 */
export default function SuccessToast({
  message,
  onDismiss,
  durationMs = 3200,
}: SuccessToastProps) {
  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(onDismiss, durationMs)
    return () => window.clearTimeout(t)
  }, [message, onDismiss, durationMs])

  if (!message) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-[100] w-[min(92vw,24rem)] -translate-x-1/2 px-4"
    >
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-lg shadow-emerald-900/10">
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white"
          aria-hidden
        >
          ✓
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-emerald-950">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 touch-manipulation"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
