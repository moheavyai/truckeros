import { hasCarrierData } from '@/lib/member-profile'
import type {
  MemberProfile,
  MemberProfileFields,
  TeamMemberListItem,
  TeamMemberListSource,
  TeamMemberProfile,
} from '@/types/member-profile'

/** Target fields on the permit-test form that carrier/driver autofill populates. */
export type PermitCarrierDriverFormFields = {
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
  driverId: string
  cdlNumber: string
  cdlState: string
  driverPhone: string
  driverEmail: string
  dateOfBirth: string
  emergencyContact: string
}

export const EMPTY_PERMIT_CARRIER_DRIVER_FIELDS: PermitCarrierDriverFormFields = {
  companyName: '',
  usdotNumber: '',
  mcNumber: '',
  dotNumber: '',
  ein: '',
  carrierAddress: '',
  carrierPhone: '',
  carrierEmail: '',
  insuranceContact: '',
  driverFullName: '',
  driverId: '',
  cdlNumber: '',
  cdlState: '',
  driverPhone: '',
  driverEmail: '',
  dateOfBirth: '',
  emergencyContact: '',
}

function trimField(value: string | null | undefined): string {
  return (value ?? '').trim()
}

/** One-line driver summary for permit-test carrier mode: first name and/or #driverId only. */
export function formatDriverSummaryLine(
  fields: Pick<
    PermitCarrierDriverFormFields,
    'driverFullName' | 'driverId'
  >
): string {
  const name = trimField(fields.driverFullName)
  const driverId = trimField(fields.driverId)

  if (!name && !driverId) return '—'

  // Prefer first name only (no phone, CDL, or other PII in the smart title)
  const firstName = name ? name.split(/\s+/)[0] : null
  const idPart = driverId ? `#${driverId}` : null
  return [firstName, idPart].filter(Boolean).join(' ') || '—'
}

/** Extract dotNumber/mcNumber for permit agent and optimize-route API payloads. */
export function permitFormToLoadDetailsCarrierFields(
  fields: Pick<PermitCarrierDriverFormFields, 'usdotNumber' | 'mcNumber' | 'dotNumber'>
): { dotNumber?: string; mcNumber?: string } {
  const dotNumber = trimField(fields.dotNumber) || trimField(fields.usdotNumber)
  const mcNumber = trimField(fields.mcNumber)

  return {
    ...(dotNumber ? { dotNumber } : {}),
    ...(mcNumber ? { mcNumber } : {}),
  }
}
