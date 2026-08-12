/** Shared as-you-type formatters for profile/carrier identity fields. */

export function digitsOnly(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '')
}

/**
 * US phone as-you-type: (555) 123-4567
 * Accepts pastes with country code 1; caps at 10 national digits.
 */
export function formatUsPhoneInput(raw: string | null | undefined): string {
  let digits = digitsOnly(raw)
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1)
  }
  digits = digits.slice(0, 10)
  if (digits.length === 0) return ''
  if (digits.length < 4) return `(${digits}`
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

/**
 * EIN as-you-type: 12-3456789 (2 + 7 digits).
 */
export function formatEinInput(raw: string | null | undefined): string {
  const digits = digitsOnly(raw).slice(0, 9)
  if (digits.length === 0) return ''
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}-${digits.slice(2)}`
}

/** Apply input formatting for known bootstrap/carrier identity fields. */
export function formatProfileFieldInput(key: string, value: string): string {
  if (key === 'carrier_phone' || key === 'driver_phone') {
    return formatUsPhoneInput(value)
  }
  if (key === 'ein') {
    return formatEinInput(value)
  }
  return value
}
