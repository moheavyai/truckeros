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

describe('History page UI cleanup', () => {
  it('uses AppHeader without activePage so no top nav item is highlighted', () => {
    const source = readHistorySource()

    expect(source).toContain('<AppHeader user={user} />')
    expect(source).not.toMatch(/<AppHeader[^>]*activePage=/)
  })

  it('shows only View in table row actions (no row-level Portal Assist)', () => {
    const rowActions = tableRowActionsSlice(readHistorySource())

    expect(rowActions).toContain('View')
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