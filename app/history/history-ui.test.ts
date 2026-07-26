import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const historyPagePath = path.join(process.cwd(), 'app', 'history', 'page.tsx')

function readHistorySource() {
  return readFileSync(historyPagePath, 'utf8')
}

function tableRowActionsSlice(source: string) {
  const start = source.indexOf('<td className="px-6 py-4 text-right">')
  const end = source.indexOf('{/* Details Modal */}')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function modalFooterSlice(source: string) {
  const marker = '{/* Details Modal */}'
  const start = source.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  return source.slice(start)
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

  it('shows View and Delete in table row actions (no row-level Portal Assist)', () => {
    const rowActions = tableRowActionsSlice(readHistorySource())

    expect(rowActions).toContain('View')
    expect(rowActions).toContain('Delete')
    expect(rowActions).toContain('handleDeleteOne')
    expect(rowActions).not.toContain('Portal Assist')
    expect(rowActions).not.toContain('/portal-assist?requestId=')
  })

  it('places Launch Portal Assist in the details modal footer with requestId', () => {
    const modal = modalFooterSlice(readHistorySource())

    expect(modal).toContain('Launch Portal Assist')
    expect(modal).toMatch(/href=\{`\/portal-assist\?requestId=\$\{selectedRequest\.id\}`\}/)
    expect(modal).toContain('Run New Analysis')
    expect(modal).toContain('bg-emerald-600')
    expect(modal).toContain('border border-gray-300')
    expect(modal).toMatch(/flex-col sm:flex-row/)
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

  it('exposes delete in the details modal footer', () => {
    const modal = modalFooterSlice(readHistorySource())

    expect(modal).toContain('handleDeleteOne(selectedRequest.id)')
    expect(modal).toContain('Delete')
  })
})
