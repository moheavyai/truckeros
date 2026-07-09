/**
 * VIN decoder stubs — future NHTSA vPIC / commercial decoder integration.
 * Call decodeVin() from form handlers once an API key and provider are configured.
 */

export type VinDecodeResult = {
  vin: string
  make?: string
  model?: string
  year?: string
  vehicleType?: 'tractor' | 'trailer' | 'unknown'
  grossVehicleWeightLbs?: number
  raw?: Record<string, unknown>
}

/** Placeholder: decode a VIN and return vehicle metadata. */
export async function decodeVin(_vin: string, _vehicleType: 'tractor' | 'trailer'): Promise<VinDecodeResult | null> {
  // TODO: POST to /api/vin-decode or external NHTSA vPIC API
  return null
}

/** Form handler hook — wire to Tractor/Trailer VIN onBlur in permit-test. */
export async function handleVinDecode(
  vin: string,
  vehicleType: 'tractor' | 'trailer',
  onResult: (result: VinDecodeResult) => void
): Promise<void> {
  const normalized = vin.trim().toUpperCase()
  if (normalized.length < 11) return
  const result = await decodeVin(normalized, vehicleType)
  if (result) onResult(result)
}