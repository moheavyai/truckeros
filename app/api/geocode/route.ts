import { NextRequest } from 'next/server'
import { handleGeocodeGet } from '@/lib/geocode-route-handler'

export async function GET(request: NextRequest) {
  return handleGeocodeGet(request)
}
