import { formatDimensionDisplay } from '@/lib/parse-dimension'
import { formatLicensePlateDisplay } from '@/lib/license-plate'
import type { RigSnapshot } from '@/types/equipment'

export interface PortalEquipmentSnapshot {
  rigLine: string | null
  tractorLine: string | null
  trailerLines: string[]
  overhangLine: string | null
  legacyLine: string | null
  hasContent: boolean
}

function pickField(obj: Record<string, any>, ...keys: string[]): any {
  for (const key of keys) {
    const val = obj[key]
    if (val != null && val !== '') return val
  }
  return null
}

function formatVehicleLabel(
  profileName?: string | null,
  unitNumber?: string | null,
  year?: number | null,
  make?: string | null,
  model?: string | null
): string {
  const name = profileName || 'Unit'
  const ymm = [year, make, model].filter(Boolean).join(' ')
  const unit = unitNumber ? `#${unitNumber}` : ''
  return [name, unit, ymm].filter(Boolean).join(' — ').replace('—  ', '— ')
}

function formatTractorLine(tractor: Record<string, any>): string {
  const label = formatVehicleLabel(
    pickField(tractor, 'profile_name', 'profileName'),
    pickField(tractor, 'unit_number', 'unitNumber'),
    tractor.year,
    tractor.make,
    tractor.model
  )
  const bits = [label]
  const axles = pickField(tractor, 'num_axles', 'numAxles')
  if (axles) bits.push(`${axles} axles`)
  const len = pickField(tractor, 'overall_length_ft', 'overallLengthFt')
  if (len) bits.push(`${Number(len).toFixed(1)} ft`)
  const plate = formatLicensePlateDisplay(
    pickField(tractor, 'license_plate', 'licensePlate'),
    pickField(tractor, 'license_plate_state', 'licensePlateState')
  )
  if (plate) bits.push(plate)
  const vin = pickField(tractor, 'vin')
  if (vin) bits.push(`VIN ${vin}`)
  const empty = pickField(tractor, 'empty_weight_lbs', 'emptyWeightLbs')
  if (empty) bits.push(`${Math.round(Number(empty)).toLocaleString()} lbs empty`)
  return bits.join(' • ')
}

function formatTrailerLine(trailer: Record<string, any>, index: number): string {
  const label = formatVehicleLabel(
    pickField(trailer, 'profile_name', 'profileName') || `Trailer ${index + 1}`,
    pickField(trailer, 'unit_number', 'unitNumber'),
    trailer.year,
    trailer.make,
    trailer.model
  )
  const bits = [label]
  const len = pickField(trailer, 'overall_length_ft', 'overallLengthFt')
  if (len) bits.push(`${Number(len).toFixed(1)} ft`)
  const axles = pickField(trailer, 'num_axles', 'numAxles')
  if (axles) bits.push(`${axles} axles`)
  const trailerType = pickField(trailer, 'trailer_type', 'trailerType')
  if (trailerType) bits.push(trailerType)
  const width = pickField(trailer, 'width_ft', 'widthFt')
  if (width) bits.push(formatDimensionDisplay(Number(width)))
  const deck = pickField(trailer, 'deck_height_ft', 'deckHeightFt')
  if (deck) bits.push(`deck ${formatDimensionDisplay(Number(deck))}`)
  const plate = formatLicensePlateDisplay(
    pickField(trailer, 'license_plate', 'licensePlate'),
    pickField(trailer, 'license_plate_state', 'licensePlateState')
  )
  if (plate) bits.push(plate)
  const vin = pickField(trailer, 'vin')
  if (vin) bits.push(`VIN ${vin}`)
  const empty = pickField(trailer, 'empty_weight_lbs', 'emptyWeightLbs')
  if (empty) bits.push(`${Math.round(Number(empty)).toLocaleString()} lbs empty`)
  return bits.join(' • ')
}

function formatOverhangLine(
  equipment?: Record<string, any> | null,
  cargo?: Record<string, any> | null
): string | null {
  const loadOverhangs = equipment?.loadOverhangs as Record<string, number> | undefined
  if (loadOverhangs) {
    const frontRig = Number(loadOverhangs.frontOfRigFt || 0)
    const frontTrailer = Number(loadOverhangs.frontOfTrailerFt || 0)
    const rear = Number(loadOverhangs.rearFt || 0)
    if (frontRig || frontTrailer || rear) {
      const frontParts: string[] = []
      if (frontRig) frontParts.push(`rig ${frontRig} ft`)
      if (frontTrailer) frontParts.push(`trailer ${frontTrailer} ft`)
      const front = frontParts.length ? `front ${frontParts.join(' + ')}` : ''
      const rearPart = rear ? `rear ${rear} ft` : ''
      return [front, rearPart].filter(Boolean).join(' / ')
    }
  }

  const c = cargo || {}
  const front = pickField(c, 'overhang_front_ft', 'overhangFrontFt')
  const rear = pickField(c, 'overhang_rear_ft', 'overhangRearFt')
  if (front || rear) return `front ${front || 0} ft / rear ${rear || 0} ft`
  return null
}

function formatLegacyEquipmentLine(equipment?: Record<string, any> | null): string | null {
  if (!equipment) return null
  const parts: string[] = []
  const unit = pickField(equipment, 'unit_number', 'unitNumber', 'vin')
  if (unit) parts.push(`Unit/VIN: ${unit}`)
  const axles = pickField(equipment, 'axles', 'total_axles', 'totalAxles')
  if (axles) parts.push(`${axles} axles`)
  const trailerLen = pickField(equipment, 'trailer_length_ft', 'trailerLengthFt')
  if (trailerLen) parts.push(`${Number(trailerLen).toFixed(1)} ft trailer`)
  return parts.length ? parts.join(' • ') : null
}

/** Build structured equipment snapshot lines for Portal Assist request details. */
export function formatPortalEquipmentSnapshot(
  equipment?: Record<string, any> | null,
  cargo?: Record<string, any> | null
): PortalEquipmentSnapshot {
  const rig = equipment?.rig as RigSnapshot | null | undefined

  if (rig?.tractor || (rig?.trailers && rig.trailers.length > 0)) {
    const rigBits: string[] = []
    if (rig.rigName) rigBits.push(rig.rigName)
    if (rig.overallLengthFt) rigBits.push(`${Number(rig.overallLengthFt).toFixed(1)} ft overall`)
    if (rig.totalAxles) rigBits.push(`${rig.totalAxles} axles total`)

    const tractorLine = rig.tractor ? formatTractorLine(rig.tractor as Record<string, any>) : null
    const trailerLines = (rig.trailers || []).map((tr, i) =>
      formatTrailerLine(tr as Record<string, any>, i)
    )
    const overhangLine = formatOverhangLine(equipment, cargo)

    return {
      rigLine: rigBits.length ? rigBits.join(' • ') : null,
      tractorLine,
      trailerLines,
      overhangLine,
      legacyLine: null,
      hasContent: !!(rigBits.length || tractorLine || trailerLines.length || overhangLine),
    }
  }

  const legacyLine = formatLegacyEquipmentLine(equipment)
  const overhangLine = formatOverhangLine(equipment, cargo)

  return {
    rigLine: null,
    tractorLine: null,
    trailerLines: [],
    overhangLine,
    legacyLine,
    hasContent: !!(legacyLine || overhangLine),
  }
}