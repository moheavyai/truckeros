/** Load arrangement and move-type options for permit cargo details. */

export const LOADED_ARRANGEMENT_OPTIONS = ['side-by-side', 'end-to-end', 'stacked'] as const
export type LoadedArrangement = (typeof LOADED_ARRANGEMENT_OPTIONS)[number]
/** Fallback for sanitizing invalid/unknown arrangement values (not the form default). */
export const DEFAULT_LOADED_ARRANGEMENT: LoadedArrangement = 'side-by-side'
/** Pre-selected arrangement when number of pieces becomes greater than 1. */
export const MULTI_PIECE_DEFAULT_LOADED_ARRANGEMENT: LoadedArrangement = 'end-to-end'
/** Form value when pieces = 1 (no radio selected). */
export type LoadedArrangementFormValue = LoadedArrangement | ''

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

/**
 * Sanitize arrangement for persistence.
 * - Valid option → kept as-is
 * - Empty / null / undefined (nothing selected, e.g. pieces = 1) → null (do not invent a value)
 * - Unknown/bogus string → DEFAULT_LOADED_ARRANGEMENT for corrupt-data recovery
 */
export function sanitizeLoadedArrangement(value: unknown): LoadedArrangement | null {
  if (typeof value === 'string' && LOADED_ARRANGEMENT_SET.has(value)) {
    return value as LoadedArrangement
  }
  if (value == null || value === '') return null
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

/**
 * Sync Loaded arrangement radios with piece count.
 * - pieces = 1 → nothing selected (empty)
 * - pieces > 1 → keep a valid user selection; otherwise pre-select end-to-end
 */
export function resolveLoadedArrangementForPieces(
  pieces: number,
  current: string | null | undefined
): LoadedArrangementFormValue {
  if (clampNumberOfPieces(pieces) <= 1) return ''
  if (typeof current === 'string' && LOADED_ARRANGEMENT_SET.has(current)) {
    return current as LoadedArrangement
  }
  return MULTI_PIECE_DEFAULT_LOADED_ARRANGEMENT
}

/**
 * Apply a committed piece-count change and sync arrangement only when the count changes.
 * Preserves a manual single-piece selection when the field is re-committed at 1.
 */
export function applyNumberOfPiecesChange(
  previousPieces: number,
  nextPieces: number,
  currentArrangement: string | null | undefined
): { numberOfPieces: number; loadedArrangement: LoadedArrangementFormValue } {
  const numberOfPieces = clampNumberOfPieces(nextPieces)
  if (numberOfPieces === clampNumberOfPieces(previousPieces)) {
    // Unchanged count: keep a valid selection or empty (do not force defaults).
    if (typeof currentArrangement === 'string' && LOADED_ARRANGEMENT_SET.has(currentArrangement)) {
      return { numberOfPieces, loadedArrangement: currentArrangement as LoadedArrangement }
    }
    return { numberOfPieces, loadedArrangement: '' }
  }
  return {
    numberOfPieces,
    loadedArrangement: resolveLoadedArrangementForPieces(numberOfPieces, currentArrangement),
  }
}

/**
 * Resolve piece count (flushing draft) and sync Loaded arrangement for submit/save.
 * Shared by both approve/save paths on the permit-test page.
 */
export function resolvePiecesAndArrangementForSubmit(
  formData: { numberOfPieces: number; loadedArrangement: string },
  draft: string | null
): { numberOfPieces: number; loadedArrangement: LoadedArrangementFormValue } {
  const resolvedPieces = resolvePiecesForSubmit(formData, draft)
  return applyNumberOfPiecesChange(
    formData.numberOfPieces,
    resolvedPieces,
    formData.loadedArrangement
  )
}