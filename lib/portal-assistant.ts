// lib/portal-assistant.ts
//
// Agent-Assisted Portal Framework (Week 2 Item 1)
// 
// This module provides the foundation for interacting with state DOT OSOW permit portals.
// It is designed to be extensible — new states can be added to STATE_PORTAL_CONFIGS.
//
// Current focus: Texas (TX), California (CA), Florida (FL), Illinois (IL)
//
// Features:
// - Secure credential management helpers
// - Prefill data generator (maps our internal PermitRequest to portal fields)
// - Basic output/confirmation parser
// - Human approval gate data structure
//
// Security:
// - Never store or transmit credentials in plain text.
// - Encryption/decryption happens server-side only (see /api/portal-credentials).
// - All portal interactions should go through authenticated API routes.

// NOTE: 'crypto' import was moved to the API route (app/api/portal-credentials/route.ts)
// to prevent Turbopack client bundle errors. This file must remain safe for both client and server.

export interface PortalStateConfig {
  name: string
  portalUrl: string
  loginUrl?: string
  instructions: string
  fieldMapping: Record<string, string> // our field -> portal field label
  requiresVehicleInfo?: boolean
  typicalRestrictions?: string[]
}

export const STATE_PORTAL_CONFIGS: Record<string, PortalStateConfig> = {
  TX: {
    name: 'Texas (TxDOT)',
    portalUrl: 'https://www.txdot.gov/business/permits/osow-permits.html',
    loginUrl: 'https://txdot.gov/osow',
    instructions: 'Log into the TxDOT OSOW portal. Use the prefilled values below for the application. Pay special attention to route and bridge analysis.',
    fieldMapping: {
      origin: 'Origin Location',
      destination: 'Destination Location',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Proposed Route / Corridor',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Houston Ship Channel height limits', 'I-35 DFW weight postings'],
  },
  CA: {
    name: 'California (Caltrans)',
    portalUrl: 'https://dot.ca.gov/programs/traffic-operations/osow',
    loginUrl: 'https://caltrans.ca.gov/osow-portal',
    instructions: 'Use the Caltrans OSOW One-Stop Permitting system. California has strict curfew and heat restrictions.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Weight',
      length: 'Length',
      width: 'Width',
      height: 'Height',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Central Valley bridge ratings', 'Bay Area curfews'],
  },
  FL: {
    name: 'Florida (FDOT)',
    portalUrl: 'https://www.fdot.gov/traffic/trafficmanagement/osow.shtm',
    loginUrl: 'https://fdot.gov/osow',
    instructions: 'Florida One Stop Permitting System. Note hurricane season restrictions and Turnpike rules.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
    },
    requiresVehicleInfo: false,
    typicalRestrictions: ['Alligator Alley special rules', 'South Florida curfews'],
  },
  IL: {
    name: 'Illinois (IDOT)',
    portalUrl: 'https://idot.illinois.gov/doing-business/permits/osow.html',
    loginUrl: 'https://idot.gov/osow',
    instructions: 'IDOT OSOW Permitting System. Chicago metro has very strict weight and curfew rules.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Vehicle Weight',
      length: 'Overall Length',
      width: 'Overall Width',
      height: 'Overall Height',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['I-55/I-57 Chicago area weight limits', 'Spring thaw restrictions'],
  },
}

export interface PrefillPackage {
  state: string
  loadDetails: any
  routeCorridor: string[]
  permitRequiredStates: string[]
  generatedFields: Record<string, any>
  humanApprovalRequired: boolean
  approvalNotes: string[]
}

/**
 * Generates a structured prefill package for a specific state portal.
 * This is the core of the "auto-prefill" feature.
 */
export function generatePortalPrefill(
  request: any, 
  stateCode: string
): PrefillPackage {
  const config = STATE_PORTAL_CONFIGS[stateCode]
  if (!config) throw new Error(`Unsupported state: ${stateCode}`)

  const generated: Record<string, any> = {}

  // Map common fields
  generated.origin = `${request.origin_city}, ${request.origin_state}`
  generated.destination = `${request.destination_city}, ${request.destination_state}`
  generated.weight = request.weight
  generated.length = request.length
  generated.width = request.width
  generated.height = request.height

  if (request.route_corridor) {
    generated.route = request.route_corridor.join(' → ')
  }

  // State-specific enhancements
  if (stateCode === 'TX') {
    generated.special_notes = 'Verify Houston Ship Channel clearances'
  }
  if (stateCode === 'IL') {
    generated.special_notes = 'Chicago metro weight analysis required'
  }

  const approvalNotes: string[] = []
  let humanApprovalRequired = false

  if (request.permit_required_states?.length > 0) {
    humanApprovalRequired = true
    approvalNotes.push(`This load requires permits in ${request.permit_required_states.join(', ')}. Review all restrictions before submission.`)
  }

  return {
    state: stateCode,
    loadDetails: request,
    routeCorridor: request.route_corridor || [],
    permitRequiredStates: request.permit_required_states || [],
    generatedFields: generated,
    humanApprovalRequired,
    approvalNotes,
  }
}

/**
 * Basic parser for portal output / confirmation text.
 * In a real implementation this would be more sophisticated (PDF parsing, email parsing, or scraping).
 */
export function parsePortalOutput(stateCode: string, rawText: string) {
  const lower = rawText.toLowerCase()
  const result: any = {
    state: stateCode,
    parsedAt: new Date().toISOString(),
    permitNumber: null,
    status: 'unknown',
    approvedDimensions: null,
    restrictions: [],
    fees: null,
    rawText: rawText.substring(0, 2000),
  }

  // Very basic regex-based extraction (improve per state later)
  const permitMatch = rawText.match(/permit\s*(?:number|#|id)[:\s]*([A-Z0-9-]+)/i)
  if (permitMatch) result.permitNumber = permitMatch[1]

  if (lower.includes('approved') || lower.includes('issued')) {
    result.status = 'approved'
  } else if (lower.includes('denied') || lower.includes('rejected')) {
    result.status = 'denied'
  } else if (lower.includes('review')) {
    result.status = 'under_review'
  }

  // Extract restrictions
  const restrictionMatches = rawText.match(/(?:restriction|curfew|bridge|height|weight)[^.!?]*[.!?]/gi)
  if (restrictionMatches) {
    result.restrictions = restrictionMatches.slice(0, 5)
  }

  return result
}

// Encryption helpers were moved to app/api/portal-credentials/route.ts
// (server-only) to avoid Turbopack client bundle errors.

// =============================================
// Week 2 Item 2: Enhanced Assisted Submission
// =============================================

export interface RouteComparison {
  ourCorridor: string[]
  portalCorridor: string[]
  similarity: number // 0-100
  differences: string[]
  recommendation: 'accept' | 'review' | 'reject'
  notes: string
}

export function compareRecommendedVsPortalRoute(
  ourCorridor: string[] | null,
  portalCorridor: string[] | null
): RouteComparison {
  const our = (ourCorridor || []).map(s => s.toUpperCase())
  const portal = (portalCorridor || []).map(s => s.toUpperCase())

  if (our.length === 0 || portal.length === 0) {
    return {
      ourCorridor: our,
      portalCorridor: portal,
      similarity: 0,
      differences: ['One or both routes are empty'],
      recommendation: 'review',
      notes: 'Insufficient data for comparison',
    }
  }

  // Simple Jaccard-like similarity
  const ourSet = new Set(our)
  const portalSet = new Set(portal)
  const intersection = new Set([...ourSet].filter(x => portalSet.has(x)))
  const union = new Set([...ourSet, ...portalSet])
  const similarity = Math.round((intersection.size / union.size) * 100)

  const differences: string[] = []
  our.forEach(state => {
    if (!portalSet.has(state)) differences.push(`Our route includes ${state} (not in portal)`)
  })
  portal.forEach(state => {
    if (!ourSet.has(state)) differences.push(`Portal suggests ${state} (not in our recommendation)`)
  })

  let recommendation: 'accept' | 'review' | 'reject' = 'accept'
  let notes = 'Routes are very similar.'

  if (similarity < 60) {
    recommendation = 'reject'
    notes = 'Significant route deviation detected. Human review strongly recommended.'
  } else if (similarity < 85 || differences.length > 1) {
    recommendation = 'review'
    notes = 'Minor differences found. Please review before final approval.'
  }

  return {
    ourCorridor: our,
    portalCorridor: portal,
    similarity,
    differences,
    recommendation,
    notes,
  }
}

export interface PortalSubmissionRecord {
  id?: string
  permit_request_id: string
  state_code: string
  status: 'initiated' | 'prefilled' | 'submitted' | 'approved' | 'rejected' | 'needs_correction'
  our_recommended_corridor: string[]
  portal_returned_corridor: string[] | null
  route_comparison: RouteComparison | null
  permit_number: string | null
  portal_fees: number | null
  portal_restrictions: string[]
  user_notes: string | null
  human_approved: boolean
  created_at?: string
}

// Creates a submission record (to be saved in DB later)
export function createPortalSubmissionRecord(
  permitRequestId: string,
  stateCode: string,
  prefill: PrefillPackage,
  portalOutput?: any
): PortalSubmissionRecord {
  const comparison = portalOutput?.route_corridor 
    ? compareRecommendedVsPortalRoute(prefill.routeCorridor, portalOutput.route_corridor)
    : null

  return {
    permit_request_id: permitRequestId,
    state_code: stateCode,
    status: portalOutput ? 'submitted' : 'prefilled',
    our_recommended_corridor: prefill.routeCorridor,
    portal_returned_corridor: portalOutput?.route_corridor || null,
    route_comparison: comparison,
    permit_number: portalOutput?.permitNumber || null,
    portal_fees: null,
    portal_restrictions: portalOutput?.restrictions || [],
    user_notes: null,
    human_approved: false,
  }
}
