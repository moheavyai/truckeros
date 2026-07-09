import {
  formatLoadedArrangementLabel,
  formatMoveTypeLabel,
  formatNumberOfPiecesLabel,
} from '@/lib/load-details-options'
import { formatLoadDisplay } from '@/lib/parse-dimension'
import { formatPortalEquipmentSnapshot } from '@/lib/portal-equipment-display'

export interface ReviewField {
  label: string
  value: string
}

function pickField(obj: Record<string, any> | null | undefined, ...keys: string[]): any {
  if (!obj) return null
  for (const key of keys) {
    const val = obj[key]
    if (val != null && val !== '') return val
  }
  return null
}

function buildFields(
  obj: Record<string, any> | null | undefined,
  defs: Array<{ label: string; keys: string[] }>
): ReviewField[] {
  const fields: ReviewField[] = []
  for (const def of defs) {
    const val = pickField(obj, ...def.keys)
    if (val != null && val !== '') {
      fields.push({ label: def.label, value: String(val) })
    }
  }
  return fields
}

/** Carrier fields from saved cargo.carrierDriver snapshot. */
export function formatCarrierReviewFields(
  carrierDriver?: Record<string, any> | null
): ReviewField[] {
  return buildFields(carrierDriver, [
    { label: 'Company', keys: ['companyName', 'company_name'] },
    { label: 'USDOT', keys: ['usdotNumber', 'usdot_number'] },
    { label: 'MC', keys: ['mcNumber', 'mc_number'] },
    { label: 'DOT', keys: ['dotNumber', 'dot_number'] },
    { label: 'Address', keys: ['carrierAddress', 'carrier_address'] },
    { label: 'Phone', keys: ['carrierPhone', 'carrier_phone'] },
    { label: 'Email', keys: ['carrierEmail', 'carrier_email'] },
  ])
}

/** Driver fields from saved cargo.carrierDriver snapshot. */
export function formatDriverReviewFields(
  carrierDriver?: Record<string, any> | null
): ReviewField[] {
  return buildFields(carrierDriver, [
    { label: 'Full name', keys: ['driverFullName', 'driver_full_name'] },
    { label: 'CDL number', keys: ['cdlNumber', 'cdl_number'] },
    { label: 'CDL state', keys: ['cdlState', 'cdl_state'] },
    { label: 'Phone', keys: ['driverPhone', 'driver_phone'] },
  ])
}

export interface LoadReviewDetails {
  weight: string
  dimensionsLine: string
  overhang: string | null
  cargoDescription: string | null
  numberOfPieces: string | null
  loadedArrangement: string | null
  moveType: string | null
  hasContent: boolean
}

function resolveLoadDimensions(
  request: {
    weight?: number | null
    length?: number | null
    width?: number | null
    height?: number | null
  },
  cargo?: Record<string, any> | null
) {
  const loadSpec = (cargo?.load || {}) as Record<string, any>
  const weightLbs = pickField(loadSpec, 'weightLbs', 'weight_lbs') ?? request.weight
  const lengthFt = pickField(loadSpec, 'lengthFt', 'length_ft') ?? request.length
  const widthFt = pickField(loadSpec, 'widthFt', 'width_ft') ?? request.width
  const heightFt = pickField(loadSpec, 'heightFt', 'height_ft') ?? request.height
  return { weightLbs, lengthFt, widthFt, heightFt }
}

/** Full load details for final portal review (weight, L×W×H, overhang, cargo description). */
export function formatLoadReviewDetails(
  request: {
    weight?: number | null
    length?: number | null
    width?: number | null
    height?: number | null
  },
  equipment?: Record<string, any> | null,
  cargo?: Record<string, any> | null
): LoadReviewDetails {
  const dims = resolveLoadDimensions(request, cargo)
  const loadDisplay = formatLoadDisplay(dims)

  const equipmentSnapshot = formatPortalEquipmentSnapshot(equipment, cargo)
  const description = pickField(cargo, 'description')
  const numberOfPieces = formatNumberOfPiecesLabel(
    pickField(cargo, 'numberOfPieces', 'number_of_pieces')
  )
  const loadedArrangement = formatLoadedArrangementLabel(
    pickField(cargo, 'loadedArrangement', 'loaded_arrangement')
  )
  const moveType = formatMoveTypeLabel(pickField(cargo, 'moveType', 'move_type'))

  const hasMeaningfulWeight = dims.weightLbs != null && Number(dims.weightLbs) > 0
  const hasMeaningfulDims = [dims.lengthFt, dims.widthFt, dims.heightFt].some(
    (v) => v != null && Number(v) > 0
  )

  return {
    weight: loadDisplay.weight,
    dimensionsLine: loadDisplay.dimensionsLine,
    overhang: equipmentSnapshot.overhangLine,
    cargoDescription: description ? String(description) : null,
    numberOfPieces,
    loadedArrangement,
    moveType,
    hasContent: !!(
      hasMeaningfulWeight ||
      hasMeaningfulDims ||
      equipmentSnapshot.overhangLine ||
      description ||
      numberOfPieces ||
      loadedArrangement ||
      moveType
    ),
  }
}