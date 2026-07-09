import { NextResponse } from 'next/server'

/**
 * VIN decode API — stub for future NHTSA vPIC integration.
 * Returns 501 until decoder provider is configured.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const vin = String(body?.vin || '').trim().toUpperCase()
    if (!vin || vin.length < 11) {
      return NextResponse.json({ error: 'Valid VIN required (11+ characters)' }, { status: 400 })
    }
    return NextResponse.json(
      {
        error: 'VIN decoder not configured',
        message: 'Auto-fill from VIN will be available in a future release.',
        vin,
      },
      { status: 501 }
    )
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}