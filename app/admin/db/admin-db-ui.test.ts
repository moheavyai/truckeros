/**
 * Admin DB page static source checks for Phase 1 SQL tools.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const pagePath = path.join(process.cwd(), 'app', 'admin', 'db', 'page.tsx')

describe('admin db Phase 1 SQL tools', () => {
  it('always exposes Copy 037–041 when admin schema tools are shown', () => {
    const source = readFileSync(pagePath, 'utf8')

    expect(source).toContain('showPhase1SqlTools')
    expect(source).toContain('copyMigration037Sql')
    expect(source).toContain('copyMigration038Sql')
    expect(source).toContain('copyMigration039Sql')
    expect(source).toContain('copyMigration040Sql')
    expect(source).toContain('copyMigration041Sql')
    expect(source).toContain('Copy 037 (Phase 1b RLS)')
    expect(source).toContain('Copy 038 (self-Clerk PE)')
    expect(source).toContain('Copy 039 (self-INSERT Clerk)')
    expect(source).toContain('Copy 040 (invite UPDATE PE)')
    expect(source).toContain('Copy 041 (session match PE)')
    expect(source).toContain('migration041Sql')
  })
})
