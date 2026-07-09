import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const RESTART_COMMAND = 'npm run restart:ortools'
const RATE_LIMIT_MS = 60_000

const restartRateLimit = new Map<string, number>()

/** Clears in-memory rate-limit state (test-only). */
export function _resetRestartRateLimitForTests(): void {
  restartRateLimit.clear()
}

function getRestartScriptPath(): string {
  return path.join(process.cwd(), 'restart-ortools.ps1')
}

function spawnDetachedRestart(scriptPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false

    const finish = (handler: () => void) => {
      if (settled) return
      settled = true
      handler()
    }

    try {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Detached'],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        }
      )

      child.once('error', (err) => {
        finish(() => reject(err))
      })

      child.once('spawn', () => {
        child.unref()
        finish(() => resolve())
      })

      if (child.pid !== undefined) {
        child.unref()
        finish(() => resolve())
      }
    } catch (err) {
      finish(() => reject(err))
    }
  })
}

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      {
        success: false,
        message: 'OR-Tools restart is disabled in production. Run the restart command manually on the host.',
        command: RESTART_COMMAND,
      },
      { status: 403 }
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const lastRestartAt = restartRateLimit.get(user.id)
  if (lastRestartAt !== undefined && Date.now() - lastRestartAt < RATE_LIMIT_MS) {
    const retryAfterSeconds = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastRestartAt)) / 1000)
    return NextResponse.json(
      {
        success: false,
        message: `Restart rate limit exceeded. Wait ${retryAfterSeconds}s before trying again.`,
        command: RESTART_COMMAND,
      },
      { status: 429 }
    )
  }

  if (process.platform !== 'win32') {
    return NextResponse.json(
      {
        success: false,
        message: 'One-click restart is only available on Windows. Run the restart command manually.',
        command: RESTART_COMMAND,
      },
      { status: 501 }
    )
  }

  const scriptPath = getRestartScriptPath()
  if (!fs.existsSync(scriptPath)) {
    console.error('[restart-ortools] restart script not found:', scriptPath)
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to start restart script. Run the command manually in a terminal.',
        command: RESTART_COMMAND,
      },
      { status: 500 }
    )
  }

  try {
    await spawnDetachedRestart(scriptPath)
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[restart-ortools] failed to spawn restart script:', errMsg)
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to start restart script. Run the command manually in a terminal.',
        command: RESTART_COMMAND,
      },
      { status: 500 }
    )
  }

  restartRateLimit.set(user.id, Date.now())
  console.log('[restart-ortools] restart initiated by user', user.id)

  return NextResponse.json({
    success: true,
    message: 'OR-Tools restart initiated. Health check will re-run shortly.',
    command: RESTART_COMMAND,
  })
}