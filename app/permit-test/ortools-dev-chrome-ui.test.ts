/**
 * OR-Tools developer chrome is gated behind isDevEnvironment (NODE_ENV !== 'production').
 * Source inspection only — same pattern as load-details-ui / permit-profile-ui tests.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const permitPagePath = path.join(process.cwd(), 'app', 'permit-test', 'page.tsx')
const devModePath = path.join(process.cwd(), 'lib', 'dev-mode.ts')

function readPermitPageSource() {
  return readFileSync(permitPagePath, 'utf8')
}

/** Status banner IIFE gated by isDevEnvironment — from open gate to closing })()}. */
function gatedOrToolsStatusBlock(source: string) {
  const commentIdx = source.indexOf('OR-Tools Service Connection Status')
  expect(commentIdx).toBeGreaterThan(-1)
  const gateOpen = source.indexOf('{isDevEnvironment() && (() => {', commentIdx)
  expect(gateOpen).toBeGreaterThan(-1)
  // Gate must be immediately after the chrome comment (not a distant co-located gate)
  expect(gateOpen - commentIdx).toBeLessThan(120)

  const afterOpen = gateOpen + '{isDevEnvironment() && (() => {'.length
  const gateClose = source.indexOf('})()}', afterOpen)
  expect(gateClose).toBeGreaterThan(afterOpen)
  return source.slice(gateOpen, gateClose + '})()}'.length)
}

/** Restart message sibling, separately gated. */
function gatedRestartMessageBlock(source: string) {
  const start = source.indexOf('{isDevEnvironment() && restartOrToolsMessage && (')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('Load Pilot Voice Agent Status', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function runRouteAnalysisSlice(source: string) {
  const start = source.indexOf('const runRouteAnalysis = async () => {')
  const end = source.indexOf('const handleApproveAndSave = async () => {', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function handleChangeRouteSlice(source: string) {
  const start = source.indexOf('const handleChangeRoute = async () => {')
  const end = source.indexOf('useEffect(() => {\n    isMountedRef.current = true', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function countOccurrences(haystack: string, needle: string) {
  if (!needle) return 0
  let count = 0
  let idx = 0
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1
    idx += needle.length
  }
  return count
}

describe('Permit test page — OR-Tools dev chrome production gate', () => {
  it('imports isDevEnvironment from lib/dev-mode', () => {
    const source = readPermitPageSource()
    expect(source).toContain("from '@/lib/dev-mode'")
    expect(source).toContain('isDevEnvironment')
  })

  it('defines isDevEnvironment as NODE_ENV !== production', () => {
    const devMode = readFileSync(devModePath, 'utf8')
    expect(devMode).toContain('export function isDevEnvironment')
    expect(devMode).toContain("process.env.NODE_ENV !== 'production'")
  })

  it('contains Test Connection and Restart only inside the isDevEnvironment status gate', () => {
    const source = readPermitPageSource()
    const gated = gatedOrToolsStatusBlock(source)

    // Contained in the gated IIFE (not merely co-located in a larger page region)
    expect(gated).toContain(": 'Test Connection'")
    expect(gated).toContain('Restart OR-Tools Service')
    expect(gated).toContain('OR-Tools: Connected')
    expect(gated).toContain('OR-Tools: Unreachable')
    expect(gated).toContain('checkOrToolsHealth({ manual: true })')
    expect(gated).toContain('restartOrToolsService()')
    expect(gated).toMatch(/^\{isDevEnvironment\(\) && \(\(\) => \{/)
    expect(gated).toMatch(/\}\)\(\)\}$/)

    // Button labels appear only once in the whole page (inside this gate)
    expect(countOccurrences(source, ": 'Test Connection'")).toBe(1)
    expect(countOccurrences(source, 'Restart OR-Tools Service')).toBe(1)
    expect(countOccurrences(gated, ": 'Test Connection'")).toBe(1)
    expect(countOccurrences(gated, 'Restart OR-Tools Service')).toBe(1)

    // Outside the gated block, those UI strings must not appear
    const withoutGated = source.slice(0, source.indexOf(gated)) + source.slice(source.indexOf(gated) + gated.length)
    expect(withoutGated).not.toContain(": 'Test Connection'")
    expect(withoutGated).not.toContain('Restart OR-Tools Service')
    expect(withoutGated).not.toContain('checkOrToolsHealth({ manual: true })')
  })

  it('gates restart status message separately with isDevEnvironment', () => {
    const messageBlock = gatedRestartMessageBlock(readPermitPageSource())
    expect(messageBlock).toMatch(/isDevEnvironment\(\)\s*&&\s*restartOrToolsMessage/)
    expect(messageBlock).toContain('npm run restart:ortools')
  })

  it('keeps health/restart handlers in page source for local use', () => {
    const source = readPermitPageSource()

    expect(source).toContain('const checkOrToolsHealth = useCallback')
    expect(source).toContain('const restartOrToolsService = useCallback')
    expect(source).toContain("fetch('/api/ortools-health'")
    expect(source).toContain("fetch('/api/restart-ortools'")
  })

  it('skips auto health probes outside dev environment', () => {
    const source = readPermitPageSource()

    expect(source).toContain('// Auto-check OR-Tools health once per mount after auth (dev-only debug chrome)')
    expect(source).toContain('// Re-probe when user returns to tab if service was unreachable (dev-only)')
    const autoCheckStart = source.indexOf('Auto-check OR-Tools health once per mount')
    const reProbeStart = source.indexOf('Re-probe when user returns to tab if service was unreachable')
    expect(autoCheckStart).toBeGreaterThan(-1)
    expect(reProbeStart).toBeGreaterThan(autoCheckStart)

    const autoSlice = source.slice(autoCheckStart, reProbeStart)
    const reProbeEnd = source.indexOf('// Check if the new columns have been added', reProbeStart)
    const reProbeSlice = source.slice(reProbeStart, reProbeEnd)

    expect(autoSlice).toContain('if (!isDevEnvironment()) return')
    expect(reProbeSlice).toContain('if (!isDevEnvironment()) return')
  })

  it('gates post-analyze and post-change-route health refresh with isDevEnvironment', () => {
    const source = readPermitPageSource()
    const analyze = runRouteAnalysisSlice(source)
    const changeRoute = handleChangeRouteSlice(source)

    // Post-run health refresh only — product optimize fetch must already have run above
    const analyzeHealthIdx = analyze.indexOf('void checkOrToolsHealthRef.current?.()')
    const analyzeFetchIdx = analyze.indexOf("fetch('/api/optimize-route'")
    expect(analyzeFetchIdx).toBeGreaterThan(-1)
    expect(analyzeHealthIdx).toBeGreaterThan(analyzeFetchIdx)

    const analyzeFinally = analyze.slice(analyze.lastIndexOf('} finally {'))
    expect(analyzeFinally).toMatch(
      /if \(isDevEnvironment\(\)\) \{\s*void checkOrToolsHealthRef\.current\?\.\(\)/
    )

    const changeHealthIdx = changeRoute.indexOf('void checkOrToolsHealthRef.current?.()')
    const changeFetchIdx = changeRoute.indexOf("fetch('/api/optimize-route'")
    expect(changeFetchIdx).toBeGreaterThan(-1)
    expect(changeHealthIdx).toBeGreaterThan(changeFetchIdx)

    const changeFinally = changeRoute.slice(changeRoute.lastIndexOf('} finally {'))
    expect(changeFinally).toMatch(
      /if \(isDevEnvironment\(\) && optimizationMode === 'ortools'\) \{\s*void checkOrToolsHealthRef\.current\?\.\(\)/
    )

    // Exactly two post-run ref calls (analyze + change-route); assignment is separate
    expect(countOccurrences(source, 'void checkOrToolsHealthRef.current?.()')).toBe(2)
  })

  it('does not gate product OR-Tools route analysis behind isDevEnvironment', () => {
    const source = readPermitPageSource()
    const analyze = runRouteAnalysisSlice(source)
    const changeRoute = handleChangeRouteSlice(source)

    // Primary product path: optimize-route always invoked with ortools mode
    expect(analyze).toContain("fetch('/api/optimize-route'")
    expect(analyze).toContain("optimizationMode: 'ortools'")
    expect(source).toContain("const optimizationMode = 'ortools' as const")

    // runRouteAnalysis body must not early-return when not in dev (would break prod routing)
    expect(analyze).not.toMatch(/if\s*\(\s*!isDevEnvironment\(\)\s*\)\s*return/)
    expect(analyze).not.toMatch(/if\s*\(\s*isDevEnvironment\(\)\s*\)\s*\{[\s\S]*fetch\('\/api\/optimize-route'/)

    // isDevEnvironment in runRouteAnalysis is only used for the post-run health refresh in finally
    const analyzeDevUses = analyze.match(/isDevEnvironment\(\)/g) || []
    expect(analyzeDevUses).toHaveLength(1)
    expect(analyze.slice(analyze.indexOf('} finally {'))).toContain('isDevEnvironment()')

    // Change-route product path also runs optimize-route without a top-level dev early-return
    expect(changeRoute).toContain("fetch('/api/optimize-route'")
    expect(changeRoute).not.toMatch(/if\s*\(\s*!isDevEnvironment\(\)\s*\)\s*return/)
    const changeDevUses = changeRoute.match(/isDevEnvironment\(\)/g) || []
    expect(changeDevUses).toHaveLength(1)
    expect(changeRoute.slice(changeRoute.lastIndexOf('} finally {'))).toContain('isDevEnvironment()')

    // analyze-permit remains available on the non-ortools change-route branch (product path intact)
    expect(changeRoute).toContain("fetch('/api/analyze-permit'")
  })
})
