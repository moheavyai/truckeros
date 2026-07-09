import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockConnect = vi.fn()
const mockQuery = vi.fn()
const mockEnd = vi.fn()

vi.mock('pg', () => ({
  default: {
    Client: vi.fn(() => ({
      connect: mockConnect,
      query: mockQuery,
      end: mockEnd,
    })),
  },
}))

import pg from 'pg'
import {
  getDatabaseConnectionString,
  getPgSslConfig,
  PG_CONNECTION_TIMEOUT_MS,
  runMigrationSql,
} from './db-migrate'

describe('db-migrate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.DATABASE_URL
    delete process.env.SUPABASE_DB_PASSWORD
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://usvunsqdopddvufsxvxx.supabase.co'
  })

  it('returns DATABASE_URL when set', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:secret@localhost:5432/postgres'
    expect(getDatabaseConnectionString()).toBe(process.env.DATABASE_URL)
  })

  it('builds connection string from SUPABASE_DB_PASSWORD and project URL', () => {
    process.env.SUPABASE_DB_PASSWORD = 'p@ss word'
    expect(getDatabaseConnectionString()).toBe(
      'postgresql://postgres:p%40ss%20word@db.usvunsqdopddvufsxvxx.supabase.co:5432/postgres'
    )
  })

  it('returns null when no connection env vars are set', () => {
    expect(getDatabaseConnectionString()).toBeNull()
  })

  it('verifies TLS certificates in production', () => {
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    expect(getPgSslConfig()).toEqual({ rejectUnauthorized: true })
    process.env.NODE_ENV = original
  })

  it('allows self-signed certs only outside production', () => {
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    expect(getPgSslConfig()).toEqual({ rejectUnauthorized: false })
    process.env.NODE_ENV = original
  })

  it('rejects when no database connection string is available', async () => {
    await expect(runMigrationSql('ALTER TABLE foo ADD COLUMN bar text;')).rejects.toThrow(
      /No database connection/
    )
  })

  it('runs migration SQL through pg client', async () => {
    process.env.DATABASE_URL = 'postgresql://postgres:secret@localhost:5432/postgres'
    mockConnect.mockResolvedValue(undefined)
    mockQuery.mockResolvedValue({ rows: [] })
    mockEnd.mockResolvedValue(undefined)

    await runMigrationSql('ALTER TABLE foo ADD COLUMN bar text;')

    expect(mockConnect).toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledWith('ALTER TABLE foo ADD COLUMN bar text;')
    expect(mockEnd).toHaveBeenCalled()
  })

  it('uses a connection timeout when opening pg client', async () => {
    process.env.DATABASE_URL = 'postgresql://postgres:secret@localhost:5432/postgres'
    mockConnect.mockResolvedValue(undefined)
    mockQuery.mockResolvedValue({ rows: [] })
    mockEnd.mockResolvedValue(undefined)

    await runMigrationSql('ALTER TABLE foo ADD COLUMN bar text;')

    expect(pg.Client).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
      })
    )
  })

  it('calls client.end() when query fails', async () => {
    process.env.DATABASE_URL = 'postgresql://postgres:secret@localhost:5432/postgres'
    mockConnect.mockResolvedValue(undefined)
    mockQuery.mockRejectedValue(new Error('query failed'))
    mockEnd.mockResolvedValue(undefined)

    await expect(runMigrationSql('ALTER TABLE foo ADD COLUMN bar text;')).rejects.toThrow(
      'query failed'
    )

    expect(mockEnd).toHaveBeenCalledTimes(1)
  })
})