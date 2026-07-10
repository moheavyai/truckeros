import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { POST } from './route'
import { _resetRestartRateLimitForTests } from '@/lib/restart-ortools-rate-limit'

const mockGetUser = vi.fn()
const mockUnref = vi.fn()
const mockSpawn = vi.fn()
const mockExistsSync = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}))

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  },
}))

function createMockChild(options?: { pid?: number; emitError?: Error; emitSpawn?: boolean }) {
  const child = new EventEmitter() as EventEmitter & { pid?: number; unref: () => void }
  child.unref = mockUnref
  child.pid = options?.pid

  queueMicrotask(() => {
    if (options?.emitError) {
      child.emit('error', options.emitError)
      return
    }
    if (options?.emitSpawn !== false) {
      child.emit('spawn')
    }
  })

  return child
}

describe('POST /api/restart-ortools', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.restoreAllMocks()
    _resetRestartRateLimitForTests()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } })
    mockExistsSync.mockReturnValue(true)
    mockSpawn.mockImplementation(() => createMockChild({ pid: 4242 }))
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    vi.stubEnv('NODE_ENV', 'development')
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    vi.unstubAllEnvs()
    _resetRestartRateLimitForTests()
  })

  it('returns 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('returns 403 in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.success).toBe(false)
    expect(body.message).toContain('disabled in production')
    expect(body.command).toBe('npm run restart:ortools')
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('spawns detached restart script on Windows for authenticated users', async () => {
    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.message).toBe('OR-Tools restart initiated. Health check will re-run shortly.')
    expect(body.command).toBe('npm run restart:ortools')
    expect(mockSpawn).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining([
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        expect.stringMatching(/restart-ortools\.ps1$/),
        '-Detached',
      ]),
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      })
    )
    expect(mockUnref).toHaveBeenCalled()
  })

  it('returns 501 with manual command on non-Windows platforms', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(501)
    expect(body.success).toBe(false)
    expect(body.message).toBe(
      'One-click restart is only available on Windows. Run the restart command manually.'
    )
    expect(body.command).toBe('npm run restart:ortools')
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('returns 500 when restart script is missing', async () => {
    mockExistsSync.mockReturnValue(false)

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.success).toBe(false)
    expect(body.message).toBe(
      'Failed to start restart script. Run the command manually in a terminal.'
    )
    expect(body.command).toBe('npm run restart:ortools')
    expect(body.error).toBeUndefined()
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('returns 500 when spawn throws synchronously', async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error('spawn EACCES')
    })

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.success).toBe(false)
    expect(body.message).toBe(
      'Failed to start restart script. Run the command manually in a terminal.'
    )
    expect(body.command).toBe('npm run restart:ortools')
    expect(body.error).toBeUndefined()
  })

  it('returns 500 when child emits an error event', async () => {
    mockSpawn.mockImplementation(() =>
      createMockChild({ emitError: new Error('ENOENT: powershell.exe not found') })
    )

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.success).toBe(false)
    expect(body.message).toBe(
      'Failed to start restart script. Run the command manually in a terminal.'
    )
    expect(body.command).toBe('npm run restart:ortools')
    expect(body.error).toBeUndefined()
  })

  it('returns 429 when restart is requested within 60 seconds', async () => {
    const first = await POST()
    expect(first.status).toBe(200)

    const second = await POST()
    const body = await second.json()

    expect(second.status).toBe(429)
    expect(body.success).toBe(false)
    expect(body.message).toMatch(/rate limit exceeded/i)
    expect(body.command).toBe('npm run restart:ortools')
    expect(mockSpawn).toHaveBeenCalledTimes(1)
  })
})
