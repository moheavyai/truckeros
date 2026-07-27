/**
 * Missouri (MoDOT Carrier Express) PortalPlaybook — data from live Single Trip
 * screens (v2 field map + v3 Application enums, Trip → Review → Payment).
 *
 * Copy-assist inventory only. User stays logged in and drives the portal.
 */

import type { PortalPlaybook } from './types'

/** MoDOT-oriented field inventory in Single Trip packet order (+ alias labels). */
const MO_FIELDS = [
  // Permit type + application tips (live enum defaults)
  { key: 'trip_type', label: 'Permit type', mapsFrom: 'trip_type' },
  {
    key: 'tip_conveyance',
    label: 'Conveyance',
    mapsFrom: 'tip_conveyance',
    enumOptions: ['Under Own Power', 'Towed', 'Hauled', 'Haul/Tow'] as const,
  },
  {
    key: 'tip_description_list',
    label: 'Description list',
    mapsFrom: 'tip_description_list',
    enumOptions: ['OTHER'] as const,
  },
  {
    key: 'tip_for_hire',
    label: 'For Hire',
    mapsFrom: 'tip_for_hire',
    enumOptions: ['Yes', 'No'] as const,
  },
  {
    key: 'tip_travel',
    label: 'Travel',
    mapsFrom: 'tip_travel',
    enumOptions: [
      'Interstate commerce crossing state line',
      'Intrastate travel within MO',
    ] as const,
  },
  {
    key: 'tip_vehicle_type',
    label: 'Vehicle Type',
    mapsFrom: 'tip_vehicle_type',
    enumOptions: [
      'PowerUnit',
      'PowerUnit + 1 Unit',
      'PowerUnit + 2 Units',
      'PowerUnit + 3 Units',
      '1 Unit',
      '2 Units',
    ] as const,
  },
  {
    key: 'tip_power_unit_type',
    label: 'Power Unit Type tip',
    mapsFrom: 'tip_power_unit_type',
    enumOptions: ['TRUCK-TRACTOR', 'TRUCK', 'AUTOMOBILE'] as const,
  },
  {
    key: 'tip_booster',
    label: 'Booster unit',
    mapsFrom: 'tip_booster',
    enumOptions: ['Yes', 'No'] as const,
  },
  { key: 'tip_piece_dims', label: 'Piece dims note', mapsFrom: 'tip_piece_dims' },
  // Load
  { key: 'load_description', label: 'Load Description', mapsFrom: 'load_description' },
  { key: 'load_pieces', label: 'Load Pieces / How Many', mapsFrom: 'load_pieces' },
  { key: 'serial_number', label: 'Serial Number', mapsFrom: 'serial_number' },
  { key: 'piece_width', label: 'Piece Width', mapsFrom: 'piece_width' },
  { key: 'piece_length', label: 'Piece Length', mapsFrom: 'piece_length' },
  { key: 'piece_height', label: 'Piece Height', mapsFrom: 'piece_height' },
  // Power unit
  { key: 'tractor_make', label: 'Power Unit Make', mapsFrom: 'tractor_make' },
  { key: 'tractor_plate', label: 'Power Unit License Number', mapsFrom: 'tractor_plate' },
  {
    key: 'tractor_plate_state',
    label: 'Power Unit License State',
    mapsFrom: 'tractor_plate_state',
  },
  { key: 'tractor_vin', label: 'Power Unit VIN', mapsFrom: 'tractor_vin' },
  { key: 'tractor_year', label: 'Power Unit Model Year', mapsFrom: 'tractor_year' },
  { key: 'tractor_model', label: 'Power Unit Model', mapsFrom: 'tractor_model' },
  { key: 'tractor_ymm', label: 'Power Unit year/make/model', mapsFrom: 'tractor_ymm' },
  {
    key: 'power_unit_type',
    label: 'Power Unit Type',
    mapsFrom: 'power_unit_type',
    enumOptions: ['TRUCK-TRACTOR', 'TRUCK', 'AUTOMOBILE'] as const,
  },
  // Unit two (primary cargo trailer)
  { key: 'trailer_make', label: 'Unit Two Make', mapsFrom: 'trailer_make' },
  { key: 'trailer_plate', label: 'Unit Two License Number', mapsFrom: 'trailer_plate' },
  {
    key: 'trailer_plate_state',
    label: 'Unit Two License State',
    mapsFrom: 'trailer_plate_state',
  },
  { key: 'trailer_vin', label: 'Unit Two VIN', mapsFrom: 'trailer_vin' },
  { key: 'trailer_year', label: 'Unit Two Model Year', mapsFrom: 'trailer_year' },
  { key: 'trailer_model', label: 'Unit Two Model', mapsFrom: 'trailer_model' },
  { key: 'trailer_ymm', label: 'Unit Two year/make/model', mapsFrom: 'trailer_ymm' },
  { key: 'unit_two_type', label: 'Unit Two Type', mapsFrom: 'unit_two_type' },
  // Unit three
  { key: 'trailer_2_make', label: 'Unit Three Make', mapsFrom: 'trailer_2_make' },
  {
    key: 'trailer_2_plate',
    label: 'Unit Three License Number',
    mapsFrom: 'trailer_2_plate',
  },
  {
    key: 'trailer_2_plate_state',
    label: 'Unit Three License State',
    mapsFrom: 'trailer_2_plate_state',
  },
  { key: 'trailer_2_vin', label: 'Unit Three VIN', mapsFrom: 'trailer_2_vin' },
  { key: 'trailer_2_year', label: 'Unit Three Model Year', mapsFrom: 'trailer_2_year' },
  { key: 'trailer_2_model', label: 'Unit Three Model', mapsFrom: 'trailer_2_model' },
  {
    key: 'trailer_2_ymm',
    label: 'Unit Three year/make/model',
    mapsFrom: 'trailer_2_ymm',
  },
  // Overall dims / weight / overhang / axles
  { key: 'width', label: 'Overall Width', mapsFrom: 'width' },
  { key: 'length', label: 'Overall Length', mapsFrom: 'length' },
  { key: 'height', label: 'Overall Height', mapsFrom: 'height' },
  { key: 'trailer_length', label: 'Trailer/Load Length', mapsFrom: 'trailer_length' },
  { key: 'weight', label: 'GVW', mapsFrom: 'weight' },
  { key: 'front_overhang', label: 'Front Overhang', mapsFrom: 'front_overhang' },
  { key: 'rear_overhang', label: 'Rear Overhang', mapsFrom: 'rear_overhang' },
  { key: 'axles', label: 'Number of Axles', mapsFrom: 'axles' },
  // Carrier / profile contact
  { key: 'carrier_usdot', label: 'USDOT', mapsFrom: 'carrier_usdot' },
  { key: 'carrier_company', label: 'Carrier name', mapsFrom: 'carrier_company' },
  { key: 'carrier_mc', label: 'MC number', mapsFrom: 'carrier_mc' },
  { key: 'contact_name', label: 'Carrier contact name', mapsFrom: 'contact_name' },
  { key: 'carrier_email', label: 'Carrier email', mapsFrom: 'carrier_email' },
  { key: 'driver_name', label: 'Driver name', mapsFrom: 'driver_name' },
  // Trip tab guidance
  { key: 'origin', label: 'Origin', mapsFrom: 'origin' },
  { key: 'destination', label: 'Destination', mapsFrom: 'destination' },
  { key: 'route', label: 'Route corridor', mapsFrom: 'route' },
  { key: 'highways', label: 'Highways', mapsFrom: 'highways' },
  { key: 'border_entry', label: 'MO entry border', mapsFrom: 'border_entry' },
  { key: 'border_exit', label: 'MO exit border', mapsFrom: 'border_exit' },
  // Aliases used by grid / resolvePortalFieldLabel (not in packet order)
  { key: 'entry_point', label: 'MO entry border', mapsFrom: 'entry_point' },
  { key: 'exit_point', label: 'MO exit border', mapsFrom: 'exit_point' },
  { key: 'vehicle_id', label: 'Power unit ID / VIN', mapsFrom: 'vehicle_id' },
] as const satisfies readonly import('./types').PlaybookField[]

/** Packet keys only (excludes model/ymm extras and border aliases used for labels). */
const MO_PACKET_ORDER = [
  'trip_type',
  'tip_conveyance',
  'tip_description_list',
  'tip_for_hire',
  'tip_travel',
  'tip_vehicle_type',
  'tip_power_unit_type',
  'tip_booster',
  'tip_piece_dims',
  'load_description',
  'load_pieces',
  'serial_number',
  'piece_width',
  'piece_length',
  'piece_height',
  'tractor_make',
  'tractor_plate',
  'tractor_plate_state',
  'tractor_vin',
  'tractor_year',
  'power_unit_type',
  'trailer_make',
  'trailer_plate',
  'trailer_plate_state',
  'trailer_vin',
  'trailer_year',
  'unit_two_type',
  'trailer_2_make',
  'trailer_2_plate',
  'trailer_2_plate_state',
  'trailer_2_vin',
  'trailer_2_year',
  'width',
  'length',
  'height',
  'trailer_length',
  'weight',
  'front_overhang',
  'rear_overhang',
  'axles',
  'carrier_usdot',
  'carrier_company',
  'carrier_mc',
  'contact_name',
  'carrier_email',
  'driver_name',
  'origin',
  'destination',
  'route',
  'highways',
  'border_entry',
  'border_exit',
] as const

const MO_APPLICATION_KEYS = [
  'trip_type',
  'tip_conveyance',
  'tip_description_list',
  'tip_for_hire',
  'tip_travel',
  'tip_vehicle_type',
  'tip_power_unit_type',
  'tip_booster',
  'tip_piece_dims',
  'load_description',
  'load_pieces',
  'serial_number',
  'piece_width',
  'piece_length',
  'piece_height',
  'tractor_make',
  'tractor_plate',
  'tractor_plate_state',
  'tractor_vin',
  'tractor_year',
  'power_unit_type',
  'trailer_make',
  'trailer_plate',
  'trailer_plate_state',
  'trailer_vin',
  'trailer_year',
  'unit_two_type',
  'trailer_2_make',
  'trailer_2_plate',
  'trailer_2_plate_state',
  'trailer_2_vin',
  'trailer_2_year',
  'width',
  'length',
  'height',
  'trailer_length',
  'weight',
  'front_overhang',
  'rear_overhang',
  'axles',
  'carrier_usdot',
  'carrier_company',
  'carrier_mc',
] as const

const MO_TRIP_KEYS = [
  'origin',
  'destination',
  'route',
  'highways',
  'border_entry',
  'border_exit',
] as const

const MO_BORDER_KEYS = ['border_entry', 'border_exit'] as const

const MO_PAYMENT_KEYS = [
  'contact_name',
  'carrier_email',
  'carrier_usdot',
  'carrier_company',
] as const

const PAY_LAST_NOTE =
  'Validate other corridor states before Submit/pay when multi-state' as const

const FEE_DISPLAY_NOTE =
  'Fee is MoDOT-displayed on Payment (single trip may show ~$15 — confirm in MoDOT; TruckerOS is not sole fee truth)' as const

const CONVEYANCE_TIP =
  'Hauled (default for typical trailer load) — options: Under Own Power | Towed | Hauled | Haul/Tow' as const

const DESCRIPTION_LIST_TIP = 'OTHER — then free-text Load Description' as const

const POWER_UNIT_TYPE_TIP =
  'TRUCK-TRACTOR (default for tractor) — options: TRUCK-TRACTOR | TRUCK | AUTOMOBILE' as const

/**
 * Missouri Carrier Express Single Trip playbook (v3).
 * Source of truth for labels, field order, steps, enums, and pay-last flags.
 */
export const MO_PLAYBOOK: PortalPlaybook = {
  stateCode: 'MO',
  portalName: 'MoDOT Carrier Express',
  portalUrl: 'https://mcs.modot.mo.gov/mce/login.htm',
  infoUrl: 'https://www.modot.org/',
  flags: {
    payLastIfMultiState: true,
    supportsSingleTrip: true,
  },
  enums: {
    conveyance: ['Under Own Power', 'Towed', 'Hauled', 'Haul/Tow'],
    travel: [
      'Interstate commerce crossing state line',
      'Intrastate travel within MO',
    ],
    vehicleType: [
      'PowerUnit',
      'PowerUnit + 1 Unit',
      'PowerUnit + 2 Units',
      'PowerUnit + 3 Units',
      '1 Unit',
      '2 Units',
    ],
    powerUnitType: ['TRUCK-TRACTOR', 'TRUCK', 'AUTOMOBILE'],
    trailerType: [
      'DOUBLE DROP TRLR',
      'SINGLE DROP TRLR',
      'LOWBOY TRLR',
      'STEP DECK TRLR',
      'FLAT BED TRLR',
      'RGN',
      'JEEP',
      'FLIP AXLE',
      'STINGER',
    ],
    forHire: ['Yes', 'No'],
    descriptionList: ['OTHER'],
    booster: ['Yes', 'No'],
  },
  notes: {
    payLast: PAY_LAST_NOTE,
    feeDisplay: FEE_DISPLAY_NOTE,
    conveyance: CONVEYANCE_TIP,
    descriptionList: DESCRIPTION_LIST_TIP,
    powerUnitType: POWER_UNIT_TYPE_TIP,
  },
  applicationKeys: MO_APPLICATION_KEYS,
  tripKeys: MO_TRIP_KEYS,
  borderKeys: MO_BORDER_KEYS,
  paymentKeys: MO_PAYMENT_KEYS,
  fields: MO_FIELDS,
  walkthrough: [
    'Login Carrier Express (mcs.modot.mo.gov)',
    'Programs → Oversize/Overweight',
    'New Application → Single Trip Permits → Single Trip',
    'Step 1 Travel Dates (From/To; 7 moving days typical)',
    'Step 2 Application fields (packet + enum tips)',
    'Trip — Street Address origin/dest → Add (TruckerOS may only have city/state; enter full street on MoDOT if required); optional Keypoint/map for borders; Analyze',
    'After Analyze — Failures = 0; Restrictions; save Trip Description / From / To',
    'Review — verify vs TruckerOS prefill',
    'Payment — carrier contact/email; fee is MoDOT-displayed; Save if other states unvalidated; multi-state: validate other corridor states before Submit/pay',
    'Paste permit # back into Portal Assist when issued',
  ],
  steps: [
    {
      id: 'login',
      title: 'Login Carrier Express (mcs.modot.mo.gov)',
      copyKeys: [],
    },
    {
      id: 'programs',
      title: 'Programs → Oversize/Overweight',
      copyKeys: [],
    },
    {
      id: 'new_app',
      title: 'New Application → Single Trip Permits → Single Trip',
      copyKeys: ['trip_type'],
    },
    {
      id: 'travel_dates',
      title: 'Step 1 Travel Dates (From/To; 7 moving days typical)',
      copyKeys: [],
    },
    {
      id: 'application',
      title: 'Step 2 Application fields (packet + enum tips)',
      copyKeys: MO_APPLICATION_KEYS,
      tips: [
        'Conveyance options: Under Own Power | Towed | Hauled | Haul/Tow — default Hauled for typical trailer load',
        'Travel: Interstate commerce crossing state line | Intrastate travel within MO — multi-state corridor → Interstate; only MO → Intrastate',
        'Vehicle Type: PowerUnit + 1 Unit | + 2 Units | + 3 Units — 1 trailer → + 1 Unit; 2 trailers → + 2 Units',
        'Power Unit Type: TRUCK-TRACTOR | TRUCK | AUTOMOBILE — default TRUCK-TRACTOR for tractor',
        'Unit Two Type: map trailer type when obvious (e.g. single drop → SINGLE DROP TRLR); else select closest on MoDOT list',
        'Booster: No unless equipment indicates booster',
        'Description list: OTHER — then Load Description free text',
      ],
    },
    {
      id: 'trip_tab',
      title: 'Trip — Street Address origin/dest → Add; Analyze',
      titleMultiState:
        'Trip — Street Address origin/dest → Add; Keypoint/map for borders; Analyze',
      // Base trip keys without borders; multiStateCopyKeys added when corridor multi-state
      copyKeys: ['origin', 'destination', 'route', 'highways'],
      multiStateCopyKeys: ['border_entry', 'border_exit'],
      tips: [
        'MoDOT Trip map: Street Address origin/dest → Add (TruckerOS prefill is often city/state only — enter full street on MoDOT if required)',
        'Optional Keypoint/map if needed',
        'Analyze route',
      ],
      multiStateTips: ['Optional Keypoint/map for MO borders'],
    },
    {
      id: 'trip_post_analyze',
      title:
        'After Analyze — Failures = 0; Restrictions; save Trip Description / From / To',
      copyKeys: [],
      tips: [
        'Confirm Failures = 0 before continuing',
        'Open Restrictions and review',
        'Save Trip Description, Trip From, and Trip To from TruckerOS origin/dest guidance',
      ],
    },
    {
      id: 'review',
      title: 'Review — verify vs TruckerOS prefill',
      copyKeys: [],
      tips: [
        'Compare MoDOT Review screen to Copy all / Application packet before Payment',
      ],
    },
    {
      id: 'payment',
      title: 'Payment — carrier contact/email; MoDOT-displayed fee',
      titleMultiState:
        'Payment — carrier contact/email; MoDOT fee; pay-last when multi-state',
      copyKeys: MO_PAYMENT_KEYS,
      tips: [
        'Use carrier contact name / company and carrier email when present (not driver as primary)',
        FEE_DISPLAY_NOTE,
      ],
      multiStateTips: [
        'Save (do not Submit/pay yet) if other corridor states are still unvalidated',
        PAY_LAST_NOTE,
      ],
    },
    {
      id: 'paste_permit',
      title: 'Paste permit # back into Portal Assist when issued',
      copyKeys: [],
    },
  ],
}

/** Packet field order derived from playbook (excludes label-only aliases). */
export const MO_PLAYBOOK_FIELD_ORDER: readonly string[] = MO_PACKET_ORDER

/** Label map derived from playbook fields. */
export const MO_PLAYBOOK_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  MO_FIELDS.map((f) => [f.key, f.label])
)
