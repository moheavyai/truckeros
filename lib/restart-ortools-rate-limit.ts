/** Per-user restart cooldown (ms). Shared by the restart-ortools route handler. */
export const RESTART_RATE_LIMIT_MS = 60_000

const restartRateLimit = new Map<string, number>()

/** Last successful restart timestamp for a user, if any. */
export function getRestartRateLimitAt(userId: string): number | undefined {
  return restartRateLimit.get(userId)
}

/** Record a successful restart for rate limiting. */
export function setRestartRateLimitAt(userId: string, timestamp: number): void {
  restartRateLimit.set(userId, timestamp)
}

/** Clears in-memory rate-limit state (test-only). */
export function _resetRestartRateLimitForTests(): void {
  restartRateLimit.clear()
}
