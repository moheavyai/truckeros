#!/usr/bin/env python3
"""Apply Step 2 Equipment-first guidance. Run from repo root: python scripts/apply_step2_equipment_first.py"""
from pathlib import Path
import sys

def must_replace(text, old, new, label):
    if old not in text:
        if 'preferEquipment' in text and label.startswith('already'):
            return text
        print(f'ERROR: block not found: {label}', file=sys.stderr)
        sys.exit(1)
    return text.replace(old, new, 1)

p = Path('lib/onboarding.ts')
if not p.exists():
    print('Run from truckeros repo root', file=sys.stderr)
    sys.exit(1)
text = p.read_text(encoding='utf-8')
if 'preferEquipment?: boolean' not in text:
    text = must_replace(text,
'''  /** When true, permit clerk copy may mention Carriers (service mode). */
  serviceMode?: boolean
}''',
'''  /** When true, permit clerk copy may mention Carriers (service mode). */
  serviceMode?: boolean
  /**
   * Owner Operator path: Step 2 prioritizes Equipment (Team still available).
   * Fleet / multi-user owners keep Team-first language.
   */
  preferEquipment?: boolean
}''',
'WelcomeCopyOptions')
    text = must_replace(text,
'''      if (step === \'team_or_equipment\') {
        return \'Company is ready. Invite your team or add equipment, then open the Dashboard.\'
      }
      return \'Manage carriers, team access, and permit operations from one place.\'
    case \'carrier_owner\':''',
'''      if (step === \'team_or_equipment\') {
        if (options?.preferEquipment) {
          return \'Company is ready. Add equipment next so route analysis has accurate data — invite your team when you need them.\'
        }
        return \'Company is ready. Invite your team or add equipment, then open the Dashboard.\'
      }
      return \'Manage carriers, team access, and permit operations from one place.\'
    case \'carrier_owner\':''',
'master subtitle')
    # NOTE: this truncated version is incomplete - user should use local apply
    p.write_text(text, encoding='utf-8')
print('partial - use full script from chat')
