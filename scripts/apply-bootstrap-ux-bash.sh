#!/usr/bin/env bash
# Pure-bash applicator (no Python). Run from truckeros repo root.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail() { echo "ERROR: $*" >&2; exit 1; }

# --- lib/member-profile.ts ---
MP=lib/member-profile.ts
[ -f "$MP" ] || fail "missing $MP"

if ! grep -q "formatProfileFieldInput" "$MP"; then
  if ! grep -q "from '@/types/member-profile'" "$MP"; then
    fail "$MP: import block not found"
  fi
  awk '
    BEGIN { done=0 }
    {
      print
      if (!done && $0 ~ /from '\''@\/types\/member-profile'\'') {
        getline
        print
        print ""
        print "export {"
        print "  digitsOnly,"
        print "  formatUsPhoneInput,"
        print "  formatEinInput,"
        print "  formatProfileFieldInput,"
        print "} from '\''@/lib/profile-field-format'\''"
        done=1
        next
      }
    }
  ' "$MP" > "$MP.tmp" && mv "$MP.tmp" "$MP"
fi

if grep -q "Complete Setup" "$MP"; then
  sed -i "s/return saving ? '\''Setting up\.\.\.'\'' : '\''Complete Setup'\''/return saving ? '\''Saving...'\'' : '\''Add equipment'\''/" "$MP"
elif ! grep -q "Add equipment" "$MP"; then
  fail "$MP: button label not found"
fi
echo "ok $MP"

# --- app/profile/page.tsx ---
PP=app/profile/page.tsx
[ -f "$PP" ] || fail "missing $PP"

if ! grep -q "formatProfileFieldInput," "$PP"; then
  sed -i "/ensureBootstrapOwnerRoles,/a\\  formatProfileFieldInput," "$PP"
fi

if ! grep -q "formatProfileFieldInput(key, value)" "$PP"; then
  sed -i 's/setForm((prev) => ({ \.\.\.prev, \[key\]: value }))/const nextValue = formatProfileFieldInput(key, value)\n    setForm((prev) => ({ ...prev, [key]: nextValue }))/' "$PP"
  if ! grep -q "formatProfileFieldInput(key, value)" "$PP"; then
    fail "$PP: could not patch updateField"
  fi
fi

if ! grep -q "router.push('/equipment')" "$PP"; then
  if command -v perl >/dev/null 2>&1; then
    perl -i -0pe 's/      const baseSuccessText = wasProfileBootstrap\n        \? '\''Welcome! Your carrier account is ready\.'\''\n        : createdNewRosterMember\n          \? '\''New team member saved\.'\''\n          : wasEditingOther\n            \? `Updated \$\{updatedName\} successfully\.\$\{reviewSuffix\}`\n            : `Profile saved successfully\.\$\{reviewSuffix\}`/      \/\/ Bootstrap complete: quiet save -> go straight to equipment (no extra step).\n      if (wasProfileBootstrap) {\n        router.push('\''\/equipment'\'')\n        return\n      }\n\n      const baseSuccessText = createdNewRosterMember\n        ? '\''New team member saved.'\''\n        : wasEditingOther\n          ? `Updated \${updatedName} successfully.\${reviewSuffix}`\n          : `Profile saved successfully.\${reviewSuffix}`/s' "$PP"
  else
    fail "$PP: need perl for bootstrap redirect patch (Git Bash usually has it)."
  fi
  if ! grep -q "router.push('/equipment')" "$PP"; then
    fail "$PP: bootstrap redirect patch did not apply"
  fi
fi

if grep -q "if (!wasProfileBootstrap)" "$PP"; then
  if command -v perl >/dev/null 2>&1; then
    perl -i -0pe 's/      if \(!wasProfileBootstrap\) \{\n        requestAnimationFrame\(\(\) => \{\n          teamSectionRef\.current\?\.scrollIntoView\(\{ behavior: '\''smooth'\'', block: '\''start'\'' \}\)\n        \}\)\n      \}/      requestAnimationFrame(() => {\n        teamSectionRef.current?.scrollIntoView({ behavior: '\''smooth'\'', block: '\''start'\'' })\n      })/s' "$PP" || true
  fi
fi
echo "ok $PP"

# --- lib/member-profile.test.ts ---
TP=lib/member-profile.test.ts
[ -f "$TP" ] || fail "missing $TP"

if ! grep -q "formatUsPhoneInput," "$TP"; then
  sed -i "/getOwnerBootstrapSaveButtonLabel,/a\\  formatUsPhoneInput,\n  formatEinInput,\n  formatProfileFieldInput,\n  digitsOnly," "$TP"
fi

if grep -q "Complete Setup" "$TP"; then
  sed -i "s/toBe('Complete Setup')/toBe('Add equipment')/" "$TP"
  sed -i "s/toBe('Setting up...')/toBe('Saving...')/" "$TP"
fi

if ! grep -q "formatUsPhoneInput / formatEinInput" "$TP"; then
  cat >> "$TP" << 'EOF'

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
EOF
fi
echo "ok $TP"
echo "Done. Review with: git diff --stat"
