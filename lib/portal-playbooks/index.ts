/**
 * Portal playbook registry — load by state code when present.
 * Missing states fall back to STATE_PORTAL_CONFIGS / generic filing kit.
 */

import {
  MO_PLAYBOOK,
  MO_PLAYBOOK_FIELD_LABELS,
  MO_PLAYBOOK_FIELD_ORDER,
} from './mo'
import type {
  PlaybookField,
  PlaybookStep,
  PortalPlaybook,
  PortalPlaybookEnums,
  PortalPlaybookFlags,
  PortalPlaybookNotes,
} from './types'

export type {
  PlaybookField,
  PlaybookFieldDraft,
  PlaybookStep,
  PortalPlaybook,
  PortalPlaybookEnums,
  PortalPlaybookFlags,
  PortalPlaybookNotes,
} from './types'

export { MO_PLAYBOOK, MO_PLAYBOOK_FIELD_ORDER, MO_PLAYBOOK_FIELD_LABELS }

/** Registered playbooks keyed by uppercase state code. */
const PLAYBOOKS: Record<string, PortalPlaybook> = {
  MO: MO_PLAYBOOK,
}

/**
 * Returns the PortalPlaybook for a state when registered, else null.
 * Callers fall back to generic portal-assistant behavior for unmapped states.
 */
export function getPlaybook(stateCode?: string | null): PortalPlaybook | null {
  if (!stateCode) return null
  const code = String(stateCode).trim().toUpperCase()
  if (!code) return null
  return PLAYBOOKS[code] ?? null
}

/** All registered state codes (uppercase). */
export function listPlaybookStates(): string[] {
  return Object.keys(PLAYBOOKS).sort()
}

/** Label map from playbook.fields (key → label). */
export function fieldLabelsFromPlaybook(
  playbook: PortalPlaybook
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of playbook.fields) {
    out[f.key] = f.label
  }
  return out
}

/**
 * Packet field order for copy-all.
 * Prefer application+trip+payment key groups when present; else fields keys
 * excluding pure aliases when walkthrough packet order is not explicit.
 */
export function fieldOrderFromPlaybook(playbook: PortalPlaybook): readonly string[] {
  // MO and future playbooks may pin packet order via application/trip keys composition
  if (playbook.stateCode === 'MO') {
    return MO_PLAYBOOK_FIELD_ORDER
  }
  const keys: string[] = []
  const seen = new Set<string>()
  const pushGroup = (group?: readonly string[]) => {
    if (!group) return
    for (const k of group) {
      if (seen.has(k)) continue
      seen.add(k)
      keys.push(k)
    }
  }
  pushGroup(playbook.applicationKeys)
  pushGroup(playbook.tripKeys)
  // contact fields often appear in application + payment; payment extras only
  if (playbook.paymentKeys) {
    for (const k of playbook.paymentKeys) {
      if (seen.has(k)) continue
      seen.add(k)
      keys.push(k)
    }
  }
  if (keys.length > 0) return keys
  return playbook.fields.map((f) => f.key)
}

/** Resolve a field label from a playbook; undefined when key unknown. */
export function getPlaybookFieldLabel(
  playbook: PortalPlaybook,
  key: string
): string | undefined {
  const hit = playbook.fields.find((f) => f.key === key)
  return hit?.label
}

/** Step copy keys for current multi-state flag (merges multiStateCopyKeys). */
export function resolveStepCopyKeys(
  step: PlaybookStep,
  multiState: boolean
): string[] {
  const base = [...(step.copyKeys || [])]
  if (multiState && step.multiStateCopyKeys?.length) {
    for (const k of step.multiStateCopyKeys) {
      if (!base.includes(k)) base.push(k)
    }
  }
  return base
}

/** Step tips for current multi-state flag. */
export function resolveStepTips(step: PlaybookStep, multiState: boolean): string[] {
  const tips = [...(step.tips || [])]
  // For trip_tab single-state we keep "Optional Keypoint/map if needed";
  // multi-state replaces that middle tip via multiStateTips when provided.
  if (multiState && step.multiStateTips?.length) {
    // If tips already include a generic Keypoint line, swap for multi-state version
    const multiKeypoint = step.multiStateTips.find((t) => /Keypoint|border/i.test(t))
    if (multiKeypoint) {
      const idx = tips.findIndex((t) => /Keypoint|border|if needed/i.test(t))
      if (idx >= 0) tips[idx] = multiKeypoint
      else tips.push(...step.multiStateTips)
      // Append remaining multi tips that are not keypoint
      for (const t of step.multiStateTips) {
        if (t !== multiKeypoint && !tips.includes(t)) tips.push(t)
      }
    } else {
      for (const t of step.multiStateTips) {
        if (!tips.includes(t)) tips.push(t)
      }
    }
  }
  return tips
}

/** Step title for current multi-state flag. */
export function resolveStepTitle(step: PlaybookStep, multiState: boolean): string {
  if (multiState && step.titleMultiState) return step.titleMultiState
  return step.title
}
