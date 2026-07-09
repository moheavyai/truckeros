/**
 * Forced carrier-owner break-glass allowlist.
 *
 * Prefer env (comma-separated), read in this order:
 * 1. Explicit argument to parseForcedCarrierOwnerEmails
 * 2. NEXT_PUBLIC_FORCED_CARRIER_OWNER_EMAILS (client + server, Next inlines for browser)
 * 3. FORCED_CARRIER_OWNER_EMAILS (server-only)
 *
 * Empty env behavior:
 * - **production** (`NODE_ENV=production`): no forced owners (empty list). Set env explicitly.
 * - **dev/test**: temporary legacy fallback to hardcoded email for local/compat.
 *
 * New deploys should set NEXT_PUBLIC_FORCED_CARRIER_OWNER_EMAILS (and optionally the
 * server-only twin) so client gates and API paths stay aligned. See `.env.local.example`.
 * Phase 3+ may fold this into platform provisioning only.
 */

/** @deprecated Prefer env; kept as non-production empty-env fallback only. */
export const FORCED_CARRIER_OWNER_EMAIL = 'andrehampton1@outlook.com'

function readForcedCarrierOwnerEnvRaw(): string {
  // NEXT_PUBLIC_ first so browser and server share the same allowlist when set.
  const publicEnv = process.env.NEXT_PUBLIC_FORCED_CARRIER_OWNER_EMAILS
  if (typeof publicEnv === 'string' && publicEnv.trim()) return publicEnv
  const serverEnv = process.env.FORCED_CARRIER_OWNER_EMAILS
  if (typeof serverEnv === 'string' && serverEnv.trim()) return serverEnv
  return ''
}

/**
 * Parse forced-owner emails from an env string (or process.env when omitted).
 * Empty env in production → []; empty env in dev/test → legacy single email.
 */
export function parseForcedCarrierOwnerEmails(envValue?: string | null): string[] {
  const raw =
    envValue !== undefined && envValue !== null ? envValue : readForcedCarrierOwnerEnvRaw()
  const fromEnv = raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  if (fromEnv.length > 0) return fromEnv
  // Production must set env explicitly — no hardcoded break-glass in prod bundles by default.
  if (process.env.NODE_ENV === 'production') return []
  return [FORCED_CARRIER_OWNER_EMAIL.toLowerCase()]
}

export function isForcedCarrierOwner(actorEmail?: string | null): boolean {
  const email = actorEmail?.trim().toLowerCase()
  if (!email) return false
  return parseForcedCarrierOwnerEmails().includes(email)
}
