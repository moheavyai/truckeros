import { NextRequest, NextResponse } from 'next/server'
import { processPermitRequest, LoadDetails } from '@/agents/permit-agent'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await processPermitRequest(body as LoadDetails)

    // Treat routing/validation failures as client errors (not 200)
    if (result.status === 'invalid') {
      return NextResponse.json(result, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to process permit request' },
      { status: 500 }
    )
  }
} 