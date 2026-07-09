import { formatDimensionDisplay } from '@/lib/parse-dimension'

/** Standard legal gross height limit (13' 6"). */
export const LEGAL_HEIGHT_FT = 13.5

export type GrossHeightDisplay = {
  /** User-facing height string in the Routing Envelope card. */
  displayText: string
  /** Subtitle under the gross height field. */
  helperText: string
  /** Whether to append "(legal)" next to the displayed height. */
  showLegalBadge: boolean
  /** True when calculated envelope height exceeds the legal limit. */
  isOversize: boolean
}

/**
 * Display rules for Routing Envelope gross height:
 * - At or below legal: show standard 13' 6" (legal), not low deck+load values
 * - Above legal: show actual calculated deck + load height
 * Underlying formData.height should remain the real calculated value for routing/agent.
 */
export function getGrossHeightDisplay(calculatedHeightFt: number): GrossHeightDisplay {
  if (!calculatedHeightFt || calculatedHeightFt <= 0) {
    return {
      displayText: '',
      helperText: '',
      showLegalBadge: false,
      isOversize: false,
    }
  }

  if (calculatedHeightFt <= LEGAL_HEIGHT_FT) {
    return {
      displayText: formatDimensionDisplay(LEGAL_HEIGHT_FT),
      helperText: 'Standard legal height',
      showLegalBadge: true,
      isOversize: false,
    }
  }

  return {
    displayText: formatDimensionDisplay(calculatedHeightFt),
    helperText: 'Deck + load (oversize)',
    showLegalBadge: false,
    isOversize: true,
  }
}