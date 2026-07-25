import {
  sanitizeLoadedArrangement,
  sanitizeMoveType,
  sanitizeNumberOfPieces,
} from '@/lib/load-details-options'
import type { AxleGroupSummary } from '@/lib/axle-groups'

/** Minimal form slice required to build the persisted cargo snapshot. */
export interface PermitCargoFormInput {
  cargoDescription: string
  cargoMakeModel: string
  cargoSerialNumber: string
  cargoManufacturer: string
  numberOfPieces: number
  loadedArrangement: string
  moveType: string
  axleWeights: number[]
  grossLoadedWeight: number
  weight: number
  length: number
  width: number
  height: number
  loadWeightLbs: string
  loadLengthFt: string
  loadWidthFt: string
  loadHeightFt: string
  companyName: string
  usdotNumber: string
  mcNumber: string
  dotNumber: string
  ein: string
  carrierAddress: string
  carrierPhone: string
  carrierEmail: string
  insuranceContact: string
  driverFullName: string
  cdlNumber: string
  cdlState: string
  driverPhone: string
  driverEmail: string
  dateOfBirth: string
  emergencyContact: string
}

export type PermitCargoSnapshotOptions = {
  organizationId?: string | null
  /** Role-based axle groups from selected rig (or synthetic form layout). */
  axleGroups?: AxleGroupSummary | null
  /** One-line group summary for portal/history display. */
  axleGroupSummary?: string | null
}

/** Build sanitized cargo snapshot for permit request persistence. */
export function buildPermitCargoSnapshot(
  formData: PermitCargoFormInput,
  selectedDriverKey: string,
  options?: PermitCargoSnapshotOptions
): Record<string, unknown> {
  return {
    ...(options?.organizationId ? { organizationId: options.organizationId } : {}),
    description: formData.cargoDescription,
    makeModel: formData.cargoMakeModel,
    serialNumber: formData.cargoSerialNumber,
    manufacturer: formData.cargoManufacturer,
    numberOfPieces: sanitizeNumberOfPieces(formData.numberOfPieces),
    loadedArrangement: sanitizeLoadedArrangement(formData.loadedArrangement),
    moveType: sanitizeMoveType(formData.moveType),
    axleWeights: formData.axleWeights,
    grossLoadedWeight: formData.grossLoadedWeight,
    ...(options?.axleGroups
      ? {
          axleGroups: options.axleGroups,
          axleGroupSummary:
            options.axleGroupSummary ??
            (options.axleGroups.totalAxles > 0
              ? `${options.axleGroups.totalAxles} axles`
              : null),
        }
      : options?.axleGroupSummary
        ? { axleGroupSummary: options.axleGroupSummary }
        : {}),
    envelope: {
      weight: formData.weight,
      length: formData.length,
      width: formData.width,
      height: formData.height,
    },
    load: {
      weightLbs: formData.loadWeightLbs ? Number(formData.loadWeightLbs) : null,
      lengthFt: formData.loadLengthFt ? Number(formData.loadLengthFt) : null,
      widthFt: formData.loadWidthFt ? Number(formData.loadWidthFt) : null,
      heightFt: formData.loadHeightFt ? Number(formData.loadHeightFt) : null,
    },
    carrierDriver: {
      companyName: formData.companyName,
      usdotNumber: formData.usdotNumber,
      mcNumber: formData.mcNumber,
      dotNumber: formData.dotNumber,
      ein: formData.ein,
      carrierAddress: formData.carrierAddress,
      carrierPhone: formData.carrierPhone,
      carrierEmail: formData.carrierEmail,
      insuranceContact: formData.insuranceContact,
      driverFullName: formData.driverFullName,
      cdlNumber: formData.cdlNumber,
      cdlState: formData.cdlState,
      driverPhone: formData.driverPhone,
      driverEmail: formData.driverEmail,
      dateOfBirth: formData.dateOfBirth,
      emergencyContact: formData.emergencyContact,
      selectedDriverKey,
    },
  }
}