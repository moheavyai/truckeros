/**
 * Legal document versions and helpers for MoHeavy AI (product)
 * operated by MoHeavy AI, LLC (entity).
 */

export const CURRENT_TERMS_VERSION = '2026-08-16'
export const CURRENT_PRIVACY_VERSION = '2026-08-16'

export const LEGAL_CONTACT = {
  legal: 'legal@moheavyai.com',
  privacy: 'privacy@moheavyai.com',
} as const

export type ConsentRecord = {
  terms_version: string
  terms_accepted_at: string
  privacy_version: string
  privacy_accepted_at: string
}

/** Build the payload we store on signup (table + optional user_metadata). */
export function buildConsentPayload(now = new Date()): ConsentRecord {
  const iso = now.toISOString()
  return {
    terms_version: CURRENT_TERMS_VERSION,
    terms_accepted_at: iso,
    privacy_version: CURRENT_PRIVACY_VERSION,
    privacy_accepted_at: iso,
  }
}
