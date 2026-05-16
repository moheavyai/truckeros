import { NextResponse } from 'next/server'
import { processPermitRequest } from '@/agents/permit-agent'

export async function GET() {
  // Test load with coordinates (Calvert, AL → Lincoln, NE)
  const testLoad = {
    origin: { city: 'Calvert', state: 'AL' },
    destination: { city: 'Lincoln', state: 'NE' },
    weight: 80000,
    length: 60,
    width: 9.67,
    height: 13.5,

    // These coordinates enable intelligent routing
    originLat: 31.85,
    originLon: -86.85,
    destinationLat: 40.81,
    destinationLon: -96.68,
  }

  const result = await processPermitRequest(testLoad)

  return NextResponse.json(result)
}