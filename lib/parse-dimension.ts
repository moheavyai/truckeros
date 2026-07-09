/** Parsed length/width/height — total inches rounded up to nearest inch. */
export type ParsedDimension = {
  feet: number
  inches: number
  totalInches: number
  feetDecimal: number
}

function fromTotalInches(totalInches: number): ParsedDimension {
  const rounded = Math.ceil(totalInches)
  const feet = Math.floor(rounded / 12)
  const inches = rounded % 12
  return {
    feet,
    inches,
    totalInches: rounded,
    feetDecimal: rounded / 12,
  }
}

/**
 * Parse driver-friendly dimension input:
 * - 144" / 144 in → 12'
 * - 12.5 → 12' 6"
 * - 12'6" / 12 ft 6 in / 12-6 → 12' 6"
 * - 139" → 11' 7" (round up to nearest inch)
 */
export function parseDimensionInput(raw: string): ParsedDimension | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null

  const inchSuffix = /^(?:\d+(?:\.\d+)?)\s*(?:"|''|in(?:ch(?:es)?)?|in\.)$/
  const inchMatch = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|''|in(?:ch(?:es)?)?|in\.)$/)
  if (inchMatch) {
    return fromTotalInches(parseFloat(inchMatch[1]))
  }

  const ftInMatch = s.match(
    /^(\d+)\s*(?:'|ft|feet)\s*[-\s]*(\d+(?:\.\d+)?)\s*(?:"|''|in(?:ch(?:es)?)?|in\.)?$/
  )
  if (ftInMatch) {
    const ft = parseInt(ftInMatch[1], 10)
    const inc = parseFloat(ftInMatch[2])
    return fromTotalInches(ft * 12 + inc)
  }

  const ftOnlyMatch = s.match(/^(\d+)\s*(?:'|ft|feet)\s*$/)
  if (ftOnlyMatch) {
    return fromTotalInches(parseInt(ftOnlyMatch[1], 10) * 12)
  }

  const decimalMatch = s.match(/^(\d+(?:\.\d+)?)\s*$/)
  if (decimalMatch) {
    const feet = parseFloat(decimalMatch[1])
    return fromTotalInches(feet * 12)
  }

  return null
}

/** Format decimal feet as clean 8' 6" / 60' 0" display. */
export function formatDimensionDisplay(feetDecimal: number): string {
  if (!feetDecimal || feetDecimal <= 0) return ''
  const totalInches = Math.round(feetDecimal * 12)
  const ft = Math.floor(totalInches / 12)
  const inc = totalInches % 12
  return `${ft}' ${inc}"`
}

export function feetDecimalToDisplay(feetDecimal: number): string {
  return formatDimensionDisplay(feetDecimal)
}

function formatDimOrDash(feet: number | null | undefined): string {
  if (feet == null || feet <= 0) return '—'
  return formatDimensionDisplay(Number(feet)) || '—'
}

export type LoadDisplayParts = {
  weight: string
  length: string
  width: string
  height: string
  /** Compact L × W × H line, e.g. `67' 0" × 8' 6" × 13' 6"` */
  dimensionsLine: string
}

/** Format saved load weight and dimensions for history tables and detail views. */
export function formatLoadDisplay(opts: {
  weightLbs?: number | null
  lengthFt?: number | null
  widthFt?: number | null
  heightFt?: number | null
}): LoadDisplayParts {
  const weight =
    opts.weightLbs != null && opts.weightLbs > 0
      ? `${Math.round(Number(opts.weightLbs)).toLocaleString()} lbs`
      : '—'
  const length = formatDimOrDash(opts.lengthFt)
  const width = formatDimOrDash(opts.widthFt)
  const height = formatDimOrDash(opts.heightFt)
  const hasAnyDim = [opts.lengthFt, opts.widthFt, opts.heightFt].some(
    (v) => v != null && v > 0
  )
  const dimensionsLine = hasAnyDim ? `${length} × ${width} × ${height}` : '—'
  return { weight, length, width, height, dimensionsLine }
}

/** Clean one-line rig summary: `93 Pete c/ SD — 74.0 ft × 8' 6" × 14' 8" × 60,000 lbs` */
export function formatRigSummaryLine(opts: {
  name: string
  lengthFt?: number | null
  widthFt?: number | null
  heightFt?: number | null
  weightLbs?: number | null
}): string {
  const lengthStr =
    opts.lengthFt != null && opts.lengthFt > 0 ? `${Number(opts.lengthFt).toFixed(1)} ft` : '—'
  const widthStr =
    opts.widthFt != null && opts.widthFt > 0 ? formatDimensionDisplay(Number(opts.widthFt)) : '—'
  const heightStr =
    opts.heightFt != null && opts.heightFt > 0 ? formatDimensionDisplay(Number(opts.heightFt)) : '—'
  const weightStr =
    opts.weightLbs != null && opts.weightLbs > 0
      ? `${Math.round(Number(opts.weightLbs)).toLocaleString()} lbs`
      : '—'
  return `${opts.name} — ${lengthStr} × ${widthStr} × ${heightStr} × ${weightStr}`
}