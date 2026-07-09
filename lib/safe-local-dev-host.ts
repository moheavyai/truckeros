/**
 * True only for exact local dev hostnames (not localhost.evil.com or userinfo@host).
 * Host may include a port (localhost:3000).
 */
export function isSafeLocalDevHost(host: string): boolean {
  const raw = host.trim().toLowerCase()
  if (!raw) return false

  // Reject userinfo / authority tricks (127.0.0.1:80@evil.com).
  if (raw.includes('@')) return false

  try {
    // Parse as authority via URL so hostname is extracted without userinfo ambiguity.
    const parsed = new URL(`http://${raw}`)
    if (parsed.username || parsed.password) return false
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}
