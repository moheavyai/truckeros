#!/usr/bin/env bash
# Safe local applicator for bootstrap UX remainder (phone/EIN format wiring, button, redirect).
# Run from the truckeros repo root while on branch fix/bootstrap-format-and-equipment.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

python3 - <<'PY'
from pathlib import Path

# --- lib/member-profile.ts ---
mp = Path('lib/member-profile.ts')
t = mp.read_text()
if "formatProfileFieldInput" not in t:
    needle = "} from '@/types/member-profile'\n\nexport const CARRIER_FIELD_KEYS"
    insert = "} from '@/types/member-profile'\n\nexport {\n  digitsOnly,\n  formatUsPhoneInput,\n  formatEinInput,\n  formatProfileFieldInput,\n} from '@/lib/profile-field-format'\n\nexport const CARRIER_FIELD_KEYS"
    if needle not in t:
        raise SystemExit('member-profile.ts: unexpected structure (import block)')
    t = t.replace(needle, insert, 1)

old_btn = "return saving ? 'Setting up...' : 'Complete Setup'"
new_btn = "return saving ? 'Saving...' : 'Add equipment'"
if old_btn in t:
    t = t.replace(old_btn, new_btn, 1)
elif "Add equipment" not in t:
    raise SystemExit('member-profile.ts: button label not found')
mp.write_text(t)
print('ok lib/member-profile.ts')

# --- app/profile/page.tsx ---
pp = Path('app/profile/page.tsx')
t = pp.read_text()
if 'formatProfileFieldInput,' not in t:
    needle = "  ensureBootstrapOwnerRoles,\n  getOwnerBootstrapSaveButtonLabel,"
    insert = "  ensureBootstrapOwnerRoles,\n  formatProfileFieldInput,\n  getOwnerBootstrapSaveButtonLabel,"
    if needle not in t:
        raise SystemExit('profile/page.tsx: unexpected import list')
    t = t.replace(needle, insert, 1)

old_upd = """  function updateField(key: keyof MemberProfileFormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
"""
new_upd = """  function updateField(key: keyof MemberProfileFormData, value: string) {
    const nextValue = formatProfileFieldInput(key, value)
    setForm((prev) => ({ ...prev, [key]: nextValue }))
"""
if old_upd in t:
    t = t.replace(old_upd, new_upd, 1)
elif 'formatProfileFieldInput(key, value)' not in t:
    raise SystemExit('profile/page.tsx: updateField block not found')

old_success = """      const baseSuccessText = wasProfileBootstrap
        ? 'Welcome! Your carrier account is ready.'
        : createdNewRosterMember
          ? 'New team member saved.'
          : wasEditingOther
            ? `Updated ${updatedName} successfully.${reviewSuffix}`
            : `Profile saved successfully.${reviewSuffix}`
"""
new_success = """      // Bootstrap complete: quiet save → go straight to equipment (no extra step).
      if (wasProfileBootstrap) {
        router.push('/equipment')
        return
      }

      const baseSuccessText = createdNewRosterMember
        ? 'New team member saved.'
        : wasEditingOther
          ? `Updated ${updatedName} successfully.${reviewSuffix}`
          : `Profile saved successfully.${reviewSuffix}`
"""
if old_success in t:
    t = t.replace(old_success, new_success, 1)
elif "router.push('/equipment')" not in t:
    raise SystemExit('profile/page.tsx: bootstrap success block not found')

old_scroll = """      if (!wasProfileBootstrap) {
        requestAnimationFrame(() => {
          teamSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      }
"""
new_scroll = """      requestAnimationFrame(() => {
        teamSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
"""
if old_scroll in t:
    t = t.replace(old_scroll, new_scroll, 1)

pp.write_text(t)
print('ok app/profile/page.tsx')

# --- lib/member-profile.test.ts ---
tp = Path('lib/member-profile.test.ts')
t = tp.read_text()
if 'formatUsPhoneInput,' not in t:
    needle = "  getOwnerBootstrapSaveButtonLabel,\n  carrierFieldsDiffer,"
    insert = "  getOwnerBootstrapSaveButtonLabel,\n  formatUsPhoneInput,\n  formatEinInput,\n  formatProfileFieldInput,\n  digitsOnly,\n  carrierFieldsDiffer,"
    if needle not in t:
        raise SystemExit('member-profile.test.ts: unexpected import list')
    t = t.replace(needle, insert, 1)

t = t.replace(
    "expect(getOwnerBootstrapSaveButtonLabel(false)).toBe('Complete Setup')\n    expect(getOwnerBootstrapSaveButtonLabel(true)).toBe('Setting up...')",
    "expect(getOwnerBootstrapSaveButtonLabel(false)).toBe('Add equipment')\n    expect(getOwnerBootstrapSaveButtonLabel(true)).toBe('Saving...')",
    1,
)

if "describe('formatUsPhoneInput / formatEinInput'" not in t and 'describe(\"formatUsPhoneInput / formatEinInput\"' not in t:
    block = '''

describe('formatUsPhoneInput / formatEinInput', () => {
  it('formats US phones as (XXX) XXX-XXXX while typing', () => {
    expect(formatUsPhoneInput('5')).toBe('(5')
    expect(formatUsPhoneInput('555')).toBe('(555')
    expect(formatUsPhoneInput('5551')).toBe('(555) 1')
    expect(formatUsPhoneInput('5551234567')).toBe('(555) 123-4567')
    expect(formatUsPhoneInput('15551234567')).toBe('(555) 123-4567')
    expect(formatUsPhoneInput('(555) 123-4567')).toBe('(555) 123-4567')
    expect(formatUsPhoneInput('')).toBe('')
  })

  it('formats EIN as XX-XXXXXXX', () => {
    expect(formatEinInput('1')).toBe('1')
    expect(formatEinInput('12')).toBe('12')
    expect(formatEinInput('123')).toBe('12-3')
    expect(formatEinInput('123456789')).toBe('12-3456789')
    expect(formatEinInput('12-3456789')).toBe('12-3456789')
    expect(formatEinInput('')).toBe('')
  })

  it('routes profile field keys through the shared formatter', () => {
    expect(formatProfileFieldInput('carrier_phone', '5551234567')).toBe('(555) 123-4567')
    expect(formatProfileFieldInput('driver_phone', '5559876543')).toBe('(555) 987-6543')
    expect(formatProfileFieldInput('ein', '123456789')).toBe('12-3456789')
    expect(formatProfileFieldInput('company_name', 'Acme LLC')).toBe('Acme LLC')
    expect(digitsOnly('(555) 123-4567')).toBe('5551234567')
  })
})
'''
    if not t.endswith('\n'):
        t += '\n'
    t = t.rstrip() + block + '\n'

tp.write_text(t)
print('ok lib/member-profile.test.ts')
print('Done. Review with: git diff')
PY
