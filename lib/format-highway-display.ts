/**
 * Display-only formatter for enriched OSRM highway strings.
 * Raw enriched data (e.g. "I-75 (entry 35.00,-85.21 exit 28.18,-82.39)") is kept in API/DB;
 * UI uses this helper to show clean names and optional distances.
 */
export function formatHighwayForDisplay(
  highway: string,
  distanceMi?: number | null
): string {
  const plain = highway.split(' (')[0].trim()
  if (distanceMi != null && Number.isFinite(distanceMi)) {
    return `${plain} — ${Math.round(distanceMi)} mi`
  }
  return plain
}

/** Join multiple highways for display; optional leg distance appended once at end. */
export function formatHighwaysForDisplay(
  highways: string[],
  distanceMi?: number | null
): string {
  if (!highways?.length) return ''
  const names = highways.map((h) => formatHighwayForDisplay(h))
  if (distanceMi != null && Number.isFinite(distanceMi)) {
    if (names.length === 1) {
      return formatHighwayForDisplay(highways[0], distanceMi)
    }
    return `${names.join(', ')} — ${Math.round(distanceMi)} mi`
  }
  return names.join(', ')
}