/**
 * lib/permit-length.ts
 *
 * Distinguishes trailer/rig length from overall routing envelope length
 * (trailer + load + overhangs) for length permit flagging.
 */

export const TRAILER_LEGAL_LENGTH_FT = 53
export const ENVELOPE_PERMIT_LENGTH_FT = 84.5

export function effectiveEnvelopeLengthThreshold(
  stateThresholdFt?: number | null
): number {
  if (stateThresholdFt == null || stateThresholdFt <= 0 || Number.isNaN(stateThresholdFt)) {
    return ENVELOPE_PERMIT_LENGTH_FT
  }
  // Only values above national envelope limit are true envelope permit rules.
  // Mid-range DB values (53–84.4 ft) are trailer/rig limits, not envelope thresholds.
  if (stateThresholdFt <= ENVELOPE_PERMIT_LENGTH_FT) {
    return ENVELOPE_PERMIT_LENGTH_FT
  }
  return stateThresholdFt
}

export function needsLengthPermit(
  envelopeLengthFt: number,
  trailerLengthFt?: number | null,
  stateThresholdFt?: number | null
): boolean {
  const envelope = Number(envelopeLengthFt) || 0
  const trailer =
    trailerLengthFt != null && !Number.isNaN(Number(trailerLengthFt))
      ? Number(trailerLengthFt)
      : null
  const threshold = effectiveEnvelopeLengthThreshold(stateThresholdFt)

  if (
    (trailer == null || trailer <= TRAILER_LEGAL_LENGTH_FT) &&
    envelope <= ENVELOPE_PERMIT_LENGTH_FT
  ) {
    return false
  }

  return envelope > threshold
}