/**
 * Shared PortalPlaybook schema — state filing portals as data, not one-off UI.
 *
 * User stays logged into the real portal and drives every submit; TruckerOS only
 * inventories fields / steps and supplies copy-assist prefill. No RPA, no
 * unattended crawl, no auto-submit, no credentials collection here.
 */

/** Single portal form field (or tip row) mapped for copy-assist. */
export interface PlaybookField {
  /** Stable TruckerOS / prefill key (e.g. tip_conveyance, tractor_make). */
  key: string
  /** Portal-oriented label shown in UI and clipboard packets. */
  label: string
  /** Whether the live portal treats this as required (when known). */
  required?: boolean
  /** Select option texts captured from the live portal (when known). */
  enumOptions?: readonly string[]
  /**
   * TruckerOS prefill key this field maps from when different from `key`.
   * Defaults to `key` when omitted.
   */
  mapsFrom?: string
}

/** Numbered filing step (path walkthrough + per-step copy keys). */
export interface PlaybookStep {
  id: string
  title: string
  /** Optional multi-state title override (pay-last / borders). */
  titleMultiState?: string
  description?: string
  /** Prefill keys copied for this step (may be empty). */
  copyKeys?: readonly string[]
  /**
   * Keys included only when multi-state (e.g. border_entry / border_exit).
   * Merged into copyKeys when the corridor spans 2+ states.
   */
  multiStateCopyKeys?: readonly string[]
  /** Operator tips under the step (enum options, Analyze checklist, pay-last). */
  tips?: readonly string[]
  /** Tips appended only when multi-state. */
  multiStateTips?: readonly string[]
}

/** Known portal enum option lists (live screens when mapped). */
export interface PortalPlaybookEnums {
  conveyance?: readonly string[]
  travel?: readonly string[]
  vehicleType?: readonly string[]
  powerUnitType?: readonly string[]
  trailerType?: readonly string[]
  forHire?: readonly string[]
  descriptionList?: readonly string[]
  booster?: readonly string[]
  [key: string]: readonly string[] | undefined
}

/** Behavioral flags for filing UX (not automation). */
export interface PortalPlaybookFlags {
  /** Multi-state corridor: validate other states before Submit/pay. */
  payLastIfMultiState?: boolean
  /** Playbook path is Single Trip focused. */
  supportsSingleTrip?: boolean
  [key: string]: boolean | undefined
}

/** Static operator notes / tip strings shared by packet + UI. */
export interface PortalPlaybookNotes {
  payLast?: string
  feeDisplay?: string
  conveyance?: string
  descriptionList?: string
  powerUnitType?: string
  [key: string]: string | undefined
}

/**
 * Full portal playbook for one state.
 * steps + fields drive Portal Assist when present; prefill generation stays separate.
 */
export interface PortalPlaybook {
  stateCode: string
  portalName: string
  portalUrl: string
  infoUrl?: string
  steps: readonly PlaybookStep[]
  /**
   * Fields in preferred packet / UI order.
   * Label map and field order are derived from this list.
   */
  fields: readonly PlaybookField[]
  enums?: PortalPlaybookEnums
  flags?: PortalPlaybookFlags
  notes?: PortalPlaybookNotes
  /**
   * Path-note walkthrough lines (mirrors steps; optional de-duped overview).
   * Prefer steps as path source of truth in UI.
   */
  walkthrough?: readonly string[]
  /** Prefill keys for Application step copy (subset of field keys). */
  applicationKeys?: readonly string[]
  /** Prefill keys for Trip tab (borders may be multi-state only). */
  tripKeys?: readonly string[]
  /** Border keys omitted from trip copy when single-state. */
  borderKeys?: readonly string[]
  /** Prefill keys for Payment step. */
  paymentKeys?: readonly string[]
}

/** Draft field shape produced by the assisted capture snippet (CAPTURE.md). */
export interface PlaybookFieldDraft {
  key: string
  label: string
  required?: boolean
  enumOptions?: string[]
  mapsFrom?: string
  /** Capture metadata — name/id from the live form control. */
  name?: string
  id?: string
  tagName?: string
  type?: string
}
