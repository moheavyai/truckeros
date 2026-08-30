import { createHash, randomBytes } from 'node:crypto'

/** Server-only token helpers. Do not import from client pages. */
export function hashEmailToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex')
}

export function generateEmailToken(): string {
  return randomBytes(32).toString('base64url')
}
