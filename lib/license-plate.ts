import { normalizeLicensePlateState } from '@/lib/us-states'

/** Format plate + state for cards and summaries, e.g. "ABC1234 (TX)". */
export function formatLicensePlateDisplay(
  plate?: string | null,
  state?: string | null
): string {
  const p = (plate ?? '').trim().toUpperCase()
  const s = normalizeLicensePlateState(state)
  if (p && s) return `${p} (${s})`
  if (p) return p
  if (s) return s
  return ''
}