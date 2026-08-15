import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const historyPagePath = path.join(process.cwd(), 'app', 'history', 'page.tsx')

function readHistorySource() {
  return readFileSync(historyPagePath, 'utf8')
}

function desktopTableSlice(source: string) {
  const start = source.indexOf('{/* ——— Desktop table (md+) ——— */}')
  expect(start).toBeGreaterThan(-1)
  return source.slice(start)
}

function mobileCardsSlice(source: string) {
  const start = source.indexOf('{/* ——— Mobile card list (no horizontal scroll) ——— */}')
  const end = source.indexOf('{/* ——— Desktop table (md+) ——— */}')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

/** Extract a single const handler body so scoping asserts cannot span other handlers/fetch. */
function handlerBodySlice(source: string, handlerName: string) {
  const start = source.indexOf(`const ${handlerName} = async`)
  expect(start).toBeGreaterThan(-1)
  const from = source.slice(start)
  const next = from.indexOf('\n  const ', 1)
  expect(next).toBeGreaterThan(-1)
  return from.slice(0, next)
}

describe('History page UI cleanup', () => {
  it('uses AppHeader without activePage so no top nav item is highlighted', () => {
    const source = readHistorySource()

    expect(source).toContain('<AppHeader user={user} />')
    expect(source).not.toMatch(/<AppHeader[^>]*activePage=/)
  })

  it('uses responsive main shell padding consistent with Equipment/Profile', () => {
    const source = readHistorySource()
    expect(source).toMatch(
      /max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-10 min-w-0/
    )
  })

  it('renders mobile cards without overflow-x and with stacked Portal Assist / Delete / Re-run', () => {
    const mobile = mobileCardsSlice(readHistorySource())

    expect(mobile).toContain('md:hidden')
    expect(mobile).not.toContain('overflow-x-auto')
    expect(mobile).toContain('Portal Assist')
    expect(mobile).toContain('Delete')
    expect(mobile).toContain('Re-run Analysis')
    expect(mobile).toContain('handleDeleteOne')
    expect(mobile).toContain('min-h-[44px]')
    expect(mobile).toContain('flex flex-col gap-2')
    expect(mobile).toContain('w-full')
    // Primary action is direct Portal Assist — no intermediate View modal step
    expect(mobile).not.toMatch(/>\s*View\s*</)
    expect(mobile).not.toContain('setSelectedRequest')
    expect(mobile).toMatch(/href=\{`\/portal-assist\?requestId=\$\{req\.id\}`\}/)
    expect(mobile).toContain('href="/permit-test"')
    expect(mobile).toContain('bg-emerald-600')
  })

  it('keeps desktop table dual-render with Portal Assist primary actions', () => {
    const desktop = desktopTableSlice(readHistorySource())

    expect(desktop).toContain('hidden md:block')
    expect(desktop).toContain('<table')
    expect(desktop).toContain('Portal Assist')
    expect(desktop).toContain('Delete')
    expect(desktop).toContain('Re-run')
    expect(desktop).toMatch(/href=\{`\/portal-assist\?requestId=\$\{req\.id\}`\}/)
    expect(desktop).toContain('href="/permit-test"')
    expect(desktop).not.toMatch(/>\s*View\s*</)
  })

  it('does not use an intermediate details modal for primary actions', () => {
    const source = readHistorySource()

    expect(source).not.toContain('Details Modal')
    expect(source).not.toContain('selectedRequest')
    expect(source).not.toContain('setSelectedRequest')
    // Portal Assist lives on the card/row itself
    expect(source).toMatch(/href=\{`\/portal-assist\?requestId=\$\{req\.id\}`\}/)
  })
})

describe('History page delete actions', () => {
  it('binds irreversible confirm strings to window.confirm args', () => {
    const one = handlerBodySlice(readHistorySource(), 'handleDeleteOne')
    const all = handlerBodySlice(readHistorySource(), 'handleDeleteAll')

    expect(one).toContain("window.confirm('Delete this analysis? This cannot be undone.')")
    expect(all).toContain(
      'window.confirm(`Delete ALL ${ids.length} analyses? This cannot be undone.`)'
    )
  })

  it('scopes single-delete by id and user_id inside handleDeleteOne only', () => {
    const body = handlerBodySlice(readHistorySource(), 'handleDeleteOne')

    expect(body).toMatch(
      /\.from\('permit_requests'\)\s*\n\s*\.delete\(\)\s*\n\s*\.eq\('id',\s*id\)\s*\n\s*\.eq\('user_id',\s*user\.id\)/
    )
    // Must not use the loose delete-all-style id batch inside this handler
    expect(body).not.toContain(".in('id'")
  })

  it('scopes delete-all to loaded ids plus user_id (confirm N matches delete set)', () => {
    const source = readHistorySource()
    const body = handlerBodySlice(source, 'handleDeleteAll')

    expect(source).toContain('onClick={handleDeleteAll}')
    expect(source).toContain('Delete all')
    expect(body).toContain('const ids = requests.map((r) => r.id)')
    expect(body).toMatch(
      /\.from\('permit_requests'\)\s*\n\s*\.delete\(\)\s*\n\s*\.in\('id',\s*ids\)\s*\n\s*\.eq\('user_id',\s*user\.id\)/
    )
  })

  it('disables delete controls while deleting and surfaces delete errors', () => {
    const source = readHistorySource()

    expect(source).toContain('disabled={deleting}')
    expect(source).toContain('setDeleteError')
    expect(source).toContain('deleteError')
    expect(source).toContain('role="alert"')
  })
})
