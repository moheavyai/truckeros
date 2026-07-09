import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

const TRUCK_EMOJI = '\u{1F69B}'

function collectSourceFiles(dir: string): string[] {
  const results: string[] = []

  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      results.push(...collectSourceFiles(fullPath))
      continue
    }

    if (/\.(tsx?)$/.test(entry)) {
      results.push(fullPath)
    }
  }

  return results
}

describe('site-wide cleanup regressions', () => {
  it('contains no truck emoji in app/components source', () => {
    const roots = [
      path.join(process.cwd(), 'app'),
      path.join(process.cwd(), 'components'),
    ]

    const offenders: string[] = []

    for (const root of roots) {
      for (const filePath of collectSourceFiles(root)) {
        const source = readFileSync(filePath, 'utf8')
        if (source.includes(TRUCK_EMOJI)) {
          offenders.push(path.relative(process.cwd(), filePath))
        }
      }
    }

    expect(offenders).toEqual([])
  })
})