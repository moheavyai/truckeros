/** Load arrangement and move-type options for permit cargo details. */

export const LOADED_ARRANGEMENT_OPTIONS = ['side-by-side', 'end-to-end', 'stacked'] as const
export type LoadedArrangement = (typeof LOADED_ARRANGEMENT_OPTIONS)[number]
export const DEFAULT_LOADED_ARRANGEMENT: LoadedArrangement = 'side-by-side'

export const MOVE_TYPE_OPTIONS = ['hauled', 'self-propelled', 'towed'] as const
export type MoveType = (typeof MOVE_TYPE_OPTIONS)[number]
export const DEFAULT_MOVE_TYPE: MoveType = 'hauled'

export const DEFAULT_NUMBER_OF_PIECES = 1
export const MAX_NUMBER_OF_PIECES = 999

export const LOADED_ARRANGEMENT_LABELS: Record<LoadedArrangement, string> = {
  'side-by-side': 'Side by side',
  'end-to-end': 'End to end',
  stacked: 'Stacked',
}

export const MOVE_TYPE_LABELS: Record<MoveType, string> = {
  hauled: 'Hauled',
  'self-propelled': 'Self-propelled',
  towed: 'Towed',
}

const LOADED_ARRANGEMENT_SET = new Set<string>(LOADED_ARRANGEMENT_OPTIONS)
const MOVE_TYPE_SET = new Set<string>(MOVE_TYPE_OPTIONS)

/** Ensures piece count is a finite integer between 1 and MAX_NUMBER_OF_PIECES. */
export function clampNumberOfPieces(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NUMBER_OF_PIECES
  return Math.min(MAX_NUMBER_OF_PIECES, Math.max(1, Math.round(value)))
}

/** Parse raw input with Number() then clamp (used on blur). */
export function parseAndClampPieces(raw: string): number {
  const trimmed = raw.trim()
  if (trimmed === '') return DEFAULT_NUMBER_OF_PIECES
  return clampNumberOfPieces(Number(trimmed))
}

export function formatLoadedArrangementLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !LOADED_ARRANGEMENT_SET.has(value)) return null
  return LOADED_ARRANGEMENT_LABELS[value as LoadedArrangement]
}

export function formatMoveTypeLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !MOVE_TYPE_SET.has(value)) return null
  return MOVE_TYPE_LABELS[value as MoveType]
}

export function sanitizeLoadedArrangement(value: unknown): LoadedArrangement {
  if (typeof value === 'string' && LOADED_ARRANGEMENT_SET.has(value)) {
    return value as LoadedArrangement
  }
  return DEFAULT_LOADED_ARRANGEMENT
}

export function sanitizeMoveType(value: unknown): MoveType {
  if (typeof value === 'string' && MOVE_TYPE_SET.has(value)) {
    return value as MoveType
  }
  return DEFAULT_MOVE_TYPE
}

export function sanitizeNumberOfPieces(value: unknown): number {
  if (typeof value === 'number') return clampNumberOfPieces(value)
  if (typeof value === 'string') return parseAndClampPieces(value)
  return DEFAULT_NUMBER_OF_PIECES
}

/** Display-only formatter: omits missing/invalid values (does not coerce to default). */
export function formatNumberOfPiecesLabel(value: unknown): string | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n) || n < 1) return null
  const rounded = Math.min(MAX_NUMBER_OF_PIECES, Math.round(n))
  if (rounded < 1) return null
  return `${rounded} piece${rounded === 1 ? '' : 's'}`
}

/** Resolve piece count at submit time, flushing any in-progress draft input. */
export function resolvePiecesForSubmit(
  formData: { numberOfPieces: number },
  draft: string | null
): number {
  if (draft != null) {
    return parseAndClampPieces(draft)
  }
  return sanitizeNumberOfPieces(formData.numberOfPieces)
}