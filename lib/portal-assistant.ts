// lib/portal-assistant.ts
//
// Agent-Assisted Portal Framework
// 
// This module provides the foundation for interacting with state DOT OSOW permit portals.
// It is designed to be EXTENSIBLE with minimal code — new states (up to the remaining 49, HI excluded by design) can be added to STATE_PORTAL_CONFIGS.
//
// Current: 49 states (all US except HI); selector is 100% dynamic from this const
//
// HOW TO ADD A NEW STATE (e.g. for the remaining 49; HI excluded by design):
//   1. Add entry to STATE_PORTAL_CONFIGS below: { name, portalUrl, portalType?, portalSystemName?, instructions, fieldMapping, requiresVehicleInfo?, typicalRestrictions? }
//   2. (Optional) Extend parsePortalOutput() with state-specific regex if portal format differs significantly.
//   3. Rebuild. Zero changes to UI, APIs, or history needed — selector, prefill, status, everything auto-adapts.
//
// Features:
// - Secure credential management helpers (server AES only)
// - Prefill data generator (maps PermitRequest + equipment/cargo snapshots to portal fields)
// - Basic output/confirmation parser + rich route comparison (Jaccard + recs)
// - Human approval gate (enforced before recording submission)
// - Per-state status tracking via portal_submissions (red/yellow/green)
//
// Security:
// - Never store or transmit credentials in plain text.
// - Encryption/decryption happens server-side only (see /api/portal-credentials).
// - All portal interactions should go through authenticated API routes.
// - Credentials never returned to client (metadata only from GET).

// NOTE: 'crypto' import was moved to the API route (app/api/portal-credentials/route.ts)
// to prevent Turbopack client bundle errors. This file must remain safe for both client and server.

import { formatDimensionDisplay } from '@/lib/parse-dimension'
import { classifyTrailerRole, normalizeTrailerTypeLabel } from '@/lib/trailer-types'
import {
  getPlaybook,
  MO_PLAYBOOK,
  MO_PLAYBOOK_FIELD_LABELS,
  MO_PLAYBOOK_FIELD_ORDER,
  resolveStepCopyKeys,
  resolveStepTips,
  resolveStepTitle,
} from '@/lib/portal-playbooks'

export type PortalType = 'online' | 'gotpermits' | 'phone' | 'efee'

export interface PortalStateConfig {
  name: string
  /** Direct URL to apply for or manage OS/OW permits (login or application landing). */
  portalUrl: string
  /** Optional state DOT info page when portalUrl is a login system. */
  infoUrl?: string
  /** Permit system vendor/category for UX badges and tests. */
  portalType?: PortalType
  /** Official permit system name (TxPROS, ALPASS, etc.). */
  portalSystemName?: string
  instructions: string
  fieldMapping: Record<string, string>
  requiresVehicleInfo?: boolean
  typicalRestrictions?: string[]
}

// Portal URLs verified against state DOT sites, gotpermits.com state index, and FHWA OSOW contacts (2026).
// portalUrl = direct login/application entry; infoUrl = secondary DOT guidance page when useful.
export const STATE_PORTAL_CONFIGS: Record<string, PortalStateConfig> = {
  // TxPROS is the TxDMV OSOW application system (not the generic motor-carriers info page).
  TX: {
    name: 'Texas (TxDOT)',
    portalUrl: 'https://txpros.txdmv.gov/',
    portalType: 'online',
    portalSystemName: 'TxPROS',
    infoUrl: 'https://www.txdmv.gov/motor-carriers/oversize-overweight-permits',
    instructions: 'Log into the TxDOT OSOW portal. Use the prefilled values below for the application. Pay special attention to route and bridge analysis.',
    fieldMapping: {
      origin: 'Origin Location',
      destination: 'Destination Location',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Proposed Route / Corridor',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Houston Ship Channel height limits', 'I-35 DFW weight postings'],
  },
  CA: {
    name: 'California (Caltrans)',
    portalUrl: 'https://ctps.dot.ca.gov/index.php/auth/login',
    portalType: 'online',
    portalSystemName: 'CTPS',
    instructions: 'Use the Caltrans OSOW One-Stop Permitting system. California has strict curfew and heat restrictions.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Weight',
      length: 'Length',
      width: 'Width',
      height: 'Height',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Central Valley bridge ratings', 'Bay Area curfews'],
  },
  FL: {
    name: 'Florida (FDOT)',
    portalUrl: 'https://pas.fdot.gov/',
    portalType: 'online',
    portalSystemName: 'PAS',
    instructions: 'Florida One Stop Permitting System. Note hurricane season restrictions and Turnpike rules.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
    },
    requiresVehicleInfo: false,
    typicalRestrictions: ['Alligator Alley special rules', 'South Florida curfews'],
  },
  IL: {
    name: 'Illinois (IDOT)',
    portalUrl: 'https://webapps1.dot.illinois.gov/ITAP/',
    portalType: 'online',
    portalSystemName: 'ITAP',
    instructions: 'IDOT OSOW Permitting System. Chicago metro has very strict weight and curfew rules.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Vehicle Weight',
      length: 'Overall Length',
      width: 'Overall Width',
      height: 'Overall Height',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['I-55/I-57 Chicago area weight limits', 'Spring thaw restrictions'],
  },
  MO: {
    name: 'Missouri (MoDOT)',
    portalUrl: 'https://mcs.modot.mo.gov/mce/login.htm',
    portalType: 'online',
    portalSystemName: 'MoDOT Carrier Express',
    infoUrl: 'https://www.modot.org/',
    instructions:
      'MoDOT Carrier Express (MCE) Single Trip. Path and field labels mapped from live Carrier Express screens — copy packet into the portal (no RPA). Note Missouri River crossings and I-70 restrictions.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'GVW',
      length: 'Overall Length',
      width: 'Overall Width',
      height: 'Overall Height',
      route: 'Route corridor',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Missouri River bridge restrictions', 'I-70 weight postings near KC'],
  },
  GA: {
    name: 'Georgia (GDOT)',
    portalUrl: 'https://www.gaprospermits.com/',
    portalType: 'online',
    portalSystemName: 'GAPROS',
    instructions: 'Georgia DOT Oversize/Overweight Permitting. Prefill route and dimensions; pay attention to Atlanta metro curfews and I-75/I-85.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Gross Vehicle Weight',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Intended Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Atlanta perimeter restrictions', 'I-75 construction/weight limits'],
  },
  TN: {
    name: 'Tennessee (TDOT)',
    portalUrl: 'https://tntrips.tdot.tn.gov/TNEnterprise',
    portalType: 'online',
    portalSystemName: 'TN Trips',
    instructions: 'TDOT Oversize and Overweight Permit System. Use for Southeast corridors; watch for mountain route clearances and Memphis/ Nashville rules.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Cumberland Plateau clearances', 'I-40 Memphis weight limits'],
  },
  // SWOOP (akswoop.com) is AKDOT's statewide OSOW application portal.
  AK: {
    name: 'Alaska (AKDOT&PF)',
    portalUrl: 'https://www.akswoop.com/',
    portalType: 'online',
    portalSystemName: 'SWOOP',
    infoUrl: 'https://dot.alaska.gov/mscve/pages/permits.shtml',
    instructions: 'Use the AKDOT&PF OSOW portal. Prefill the values below; account for remote and seasonal routes.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Proposed Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Remote highway limits', 'Seasonal frost restrictions'],
  },
  AL: {
    name: 'Alabama (ALDOT)',
    portalUrl: 'https://alpass.dot.state.al.us/permits/login.asp',
    portalType: 'online',
    portalSystemName: 'ALPASS',
    instructions: 'Use the ALDOT OSOW portal. Prefill the values below for permit application.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Gross Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['I-65 weight limits'],
  },
  AR: {
    name: 'Arkansas (ARDOT)',
    portalUrl: 'https://ar.gotpermits.com/',
    portalType: 'gotpermits',
    portalSystemName: 'GotPermits',
    instructions: 'Use the ARDOT OSOW permitting system. Prefill values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Route / Corridor',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: [],
  },
  AZ: {
    name: 'Arizona (ADOT)',
    portalUrl: 'https://adotepro.azdot.gov/adot/login.asp',
    portalType: 'efee',
    portalSystemName: 'ADOT ePRO',
    instructions: 'Arizona DOT OSOW permits. Use prefill for the values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Desert heat/curfew rules'],
  },
  CO: {
    name: 'Colorado (CDOT)',
    portalUrl: 'https://coopr.codot.gov/',
    portalType: 'online',
    portalSystemName: 'COOPR',
    instructions: 'Use the CDOT OSOW portal. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Vehicle Weight',
      length: 'Overall Length',
      width: 'Overall Width',
      height: 'Overall Height',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Mountain pass clearances', 'I-70 restrictions'],
  },
  // CT-CONNECT on gotpermits.com is CTDOT's online OSOW system (not portal.ct.gov/.../osow placeholder).
  CT: {
    name: 'Connecticut (CTDOT)',
    portalUrl: 'https://ct.gotpermits.com/',
    portalType: 'gotpermits',
    portalSystemName: 'CT-CONNECT',
    infoUrl: 'https://portal.ct.gov/DOT/Permits/Highways/Oversize-Overweight-Permits',
    instructions: 'CTDOT Oversize/Overweight permits. Prefill below.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
    },
    requiresVehicleInfo: false,
    typicalRestrictions: ['Northeast corridor limits'],
  },
  DE: {
    name: 'Delaware (DelDOT)',
    portalUrl: 'https://www.deldot.gov/osow/application/',
    portalType: 'online',
    portalSystemName: 'DelDOT OSOW',
    instructions: 'DelDOT OSOW portal. Use the prefilled values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: [],
  },
  ID: {
    name: 'Idaho (ITD)',
    portalUrl: 'https://permits4idaho.com/',
    portalType: 'online',
    portalSystemName: 'ITRPS',
    instructions: 'Idaho Transportation Dept OSOW. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Mountain route limits'],
  },
  // OSOW permits are issued via IN Department of Revenue Motor Carrier Services (not INDOT).
  IN: {
    name: 'Indiana (INDOT)',
    portalUrl: 'https://motorcarrier.dor.in.gov/loginHome.html',
    portalType: 'online',
    portalSystemName: 'INDOR OSW',
    instructions: 'INDOT OSOW Permitting. Prefill values for the portal.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Vehicle Weight',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['I-65/I-69 weight postings'],
  },
  IA: {
    name: 'Iowa (Iowa DOT)',
    portalUrl: 'https://ia.gotpermits.com/',
    portalType: 'gotpermits',
    portalSystemName: 'GotPermits',
    instructions: 'Use Iowa DOT OSOW system. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: [],
  },
  KS: {
    name: 'Kansas (KDOT)',
    portalUrl: 'https://k-trips.ksdot.gov/',
    portalType: 'online',
    portalSystemName: 'K-TRIPS',
    instructions: 'KDOT OSOW permits. Prefill below for application.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Proposed Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['I-70 weight limits'],
  },
  KY: {
    name: 'Kentucky (KYTC)',
    portalUrl: 'https://www.kyautomatedpermitsystem.com/',
    portalType: 'online',
    portalSystemName: 'KAPS',
    instructions: 'Kentucky Transportation Cabinet OSOW. Use prefill.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Ohio River bridge rules'],
  },
  LA: {
    name: 'Louisiana (LADOTD)',
    portalUrl: 'https://lageauxpm.dotd.la.gov/safehaul/permitting/client/permitmanager/#login',
    portalType: 'online',
    portalSystemName: 'LaGeaux',
    instructions: 'LADOTD Oversize/Overweight permits. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Gross Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Mississippi River clearances'],
  },
  ME: {
    name: 'Maine (MaineDOT)',
    portalUrl: 'https://www.movememaine.com/',
    portalType: 'online',
    portalSystemName: 'MoveME',
    instructions: 'MaineDOT OSOW portal. Prefill values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Route / Corridor',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: [],
  },
  MD: {
    name: 'Maryland (MDOT)',
    portalUrl: 'https://marylandone.gotpermits.com/',
    portalType: 'gotpermits',
    portalSystemName: 'Maryland One',
    instructions: 'MDOT OSOW permitting. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Vehicle Weight',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Baltimore area curfews'],
  },
  MA: {
    name: 'Massachusetts (MassDOT)',
    portalUrl: 'https://oasis.massdot.state.ma.us/',
    portalType: 'online',
    portalSystemName: 'OASIS',
    instructions: 'MassDOT OSOW permits. Use the prefill values below.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Northeast bridge/curfew rules'],
  },
  MI: {
    name: 'Michigan (MDOT)',
    portalUrl: 'https://milogintp.michigan.gov/eai/tplogin/authenticate?URL=/',
    portalType: 'online',
    portalSystemName: 'MiLogin TP',
    instructions: 'MDOT Michigan OSOW portal. Prefill below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Great Lakes area limits'],
  },
  MN: {
    name: 'Minnesota (MnDOT)',
    portalUrl: 'https://mn.gotpermits.com/',
    portalType: 'gotpermits',
    portalSystemName: 'SUPERLOAD',
    instructions: 'MnDOT OSOW permitting. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Winter/spring thaw restrictions'],
  },
  MS: {
    name: 'Mississippi (MDOT)',
    portalUrl: 'https://permits.mdot.ms.gov/',
    portalType: 'online',
    portalSystemName: 'Express Pass',
    instructions: 'Mississippi DOT OSOW. Prefill values below.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Gross Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: [],
  },
  MT: {
    name: 'Montana (MDT)',
    portalUrl: 'https://etrips.mtmdt.us/Login',
    portalType: 'online',
    portalSystemName: 'eTRIPS',
    instructions: 'Montana Dept of Transportation OSOW. Use prefill.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Route / Corridor',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Mountain passes', 'I-90/I-94 limits'],
  },
  NE: {
    name: 'Nebraska (NDOT)',
    portalUrl: 'https://ne.gotpermits.com/neconnect',
    portalType: 'gotpermits',
    portalSystemName: 'NEConnect',
    instructions: 'Nebraska DOT OSOW permits. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: [],
  },
  NV: {
    name: 'Nevada (NDOT)',
    portalUrl: 'https://odvp.dot.nv.gov/',
    portalType: 'online',
    portalSystemName: 'ODVP',
    instructions: 'Nevada DOT OSOW. Prefill below for the portal.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Desert and mountain rules'],
  },
  NH: {
    name: 'New Hampshire (NHDOT)',
    portalUrl: 'https://nhdotpermits.org/',
    portalType: 'online',
    portalSystemName: 'NHDOT Permits',
    instructions: 'NHDOT OSOW permits. Use prefilled values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Route / Corridor',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: [],
  },
  NJ: {
    name: 'New Jersey (NJDOT)',
    portalUrl: 'https://nj.gotpermits.com/njpass',
    portalType: 'gotpermits',
    portalSystemName: 'SUPERLOAD',
    instructions: 'NJDOT OSOW portal. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Gross Vehicle Weight',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Turnpike/Parkway rules', 'NY metro curfews'],
  },
  // NM-OPS (truckpermits.dot.nm.gov) is NMDOT's statewide online OSOW application portal.
  NM: {
    name: 'New Mexico (NMDOT)',
    portalUrl: 'https://truckpermits.dot.nm.gov/',
    portalType: 'online',
    portalSystemName: 'NM-OPS',
    infoUrl: 'https://www.dot.nm.gov/planning-research-multimodal-and-safety/modal/ports-of-entry/',
    instructions: 'NMDOT OSOW permitting. Prefill values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: [],
  },
  NY: {
    name: 'New York (NYSDOT)',
    portalUrl: 'https://hoocs.dot.ny.gov/HOOCS/',
    portalType: 'online',
    portalSystemName: 'HOOCS',
    infoUrl: 'https://www.dot.ny.gov/nypermits',
    instructions: 'NYSDOT OSOW permits. Use the prefill for the application below; note strict metro rules.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Proposed Route / Corridor',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['NYC metro height/weight', 'Hudson crossings'],
  },
  NC: {
    name: 'North Carolina (NCDOT)',
    portalUrl: 'https://pims.services.ncdot.gov/',
    portalType: 'online',
    portalSystemName: 'PIMS',
    instructions: 'NCDOT OSOW portal. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['I-40/I-85 restrictions'],
  },
  ND: {
    name: 'North Dakota (NDDOT)',
    portalUrl: 'https://apps.nd.gov/ndhp/epermits/users/main.htm',
    portalType: 'online',
    portalSystemName: 'E-Permits',
    instructions: 'North Dakota DOT OSOW. Prefill values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Route / Corridor',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Prairie frost laws'],
  },
  OH: {
    name: 'Ohio (ODOT)',
    portalUrl: 'https://haulingpermits.transportation.ohio.gov/',
    portalType: 'online',
    portalSystemName: 'OHPS',
    instructions: 'ODOT OSOW permits. Prefill the values below for Ohio portals.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Vehicle Weight',
      length: 'Overall Length',
      width: 'Overall Width',
      height: 'Overall Height',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['I-70/I-71 weight limits', 'Spring thaw'],
  },
  OK: {
    name: 'Oklahoma (ODOT)',
    portalUrl: 'https://permitmanager.okladot.state.ok.us/okiepros/login/LoginMain!input.action',
    portalType: 'online',
    portalSystemName: 'OkiePROS',
    instructions: 'Oklahoma DOT OSOW. Use prefill below.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: [],
  },
  OR: {
    name: 'Oregon (ODOT)',
    portalUrl: 'https://www.oregonorion.com/',
    portalType: 'online',
    portalSystemName: 'ORION',
    instructions: 'Oregon DOT OSOW portal. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Route / Corridor',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['I-5 corridor limits', 'Forest route rules'],
  },
  PA: {
    name: 'Pennsylvania (PennDOT)',
    portalUrl: 'https://apras.penndot.pa.gov/',
    portalType: 'online',
    portalSystemName: 'APRAS',
    instructions: 'PennDOT OSOW permitting. Prefill values for the portal.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['PA Turnpike rules', 'Bridge postings'],
  },
  RI: {
    name: 'Rhode Island (RIDOT)',
    portalUrl: 'https://www.ri.gov/DOT/osow/users/sign_in',
    portalType: 'online',
    portalSystemName: 'RIDOT OSOW',
    instructions: 'RIDOT OSOW. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: [],
  },
  SC: {
    name: 'South Carolina (SCDOT)',
    portalUrl: 'https://safehaul.scdot.org/ihaul/login/LoginMain!input.action',
    portalType: 'online',
    portalSystemName: 'SafeHaul',
    instructions: 'SCDOT OSOW portal. Use prefill for application.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Coastal route restrictions'],
  },
  SD: {
    name: 'South Dakota (SDDOT)',
    portalUrl: 'https://sdaps.sd.gov/sdaps',
    portalType: 'online',
    portalSystemName: 'SDAPS',
    instructions: 'South Dakota DOT OSOW. Prefill values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: [],
  },
  UT: {
    name: 'Utah (UDOT)',
    portalUrl: 'https://app.udot.utah.gov/public/mcs/f?p=155:1',
    portalType: 'online',
    portalSystemName: 'UDOT MCS',
    instructions: 'UDOT OSOW permits. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['I-15/I-80 mountain limits'],
  },
  VT: {
    name: 'Vermont (VTrans)',
    portalUrl: 'https://vthaulpass.vermont.gov/',
    portalType: 'online',
    portalSystemName: 'VT Haul Pass',
    instructions: 'Vermont Agency of Transportation OSOW. Prefill below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Route / Corridor',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: [],
  },
  // VA hauling permits are issued by DMV VAHPS (EZ Haul), not VDOT directly.
  VA: {
    name: 'Virginia (VDOT)',
    portalUrl: 'https://transactions.dmv.virginia.gov/apps/vahps/vahps_home.aspx',
    portalType: 'online',
    portalSystemName: 'VAHPS',
    instructions: 'VDOT OSOW portal. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Vehicle Weight',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['I-95 corridor restrictions', 'Bridge analysis'],
  },
  WA: {
    name: 'Washington (WSDOT)',
    portalUrl: 'https://www.esnoopipro.com/',
    portalType: 'online',
    portalSystemName: 'eSNOOPI Pro',
    instructions: 'WSDOT OSOW permitting. Prefill the values below for Washington portals.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Cascade mountain clearances', 'I-5 weight limits'],
  },
  WV: {
    name: 'West Virginia (WVDOT)',
    portalUrl: 'https://wv.gotpermits.com/wvconnect',
    portalType: 'gotpermits',
    portalSystemName: 'WVConnect',
    instructions: 'West Virginia DOT OSOW. Use the prefill values below.',
    fieldMapping: {
      origin: 'Origin City/State',
      destination: 'Destination City/State',
      weight: 'Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['Appalachian route limits'],
  },
  WI: {
    name: 'Wisconsin (WisDOT)',
    portalUrl: 'https://wi.gotpermits.com/WIConnect',
    portalType: 'gotpermits',
    portalSystemName: 'WIConnect',
    instructions: 'WisDOT OSOW portal. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Overall Length (ft)',
      width: 'Overall Width (ft)',
      height: 'Overall Height (ft)',
      route: 'Route / Corridor',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['I-94/I-90 spring restrictions'],
  },
  WY: {
    name: 'Wyoming (WYDOT)',
    portalUrl: 'https://jweb.dot.state.wy.us/oversize_weight_application/',
    portalType: 'online',
    portalSystemName: 'WYDOT OSOW',
    instructions: 'WYDOT OSOW permits. Prefill the values below.',
    fieldMapping: {
      origin: 'Origin',
      destination: 'Destination',
      weight: 'Gross Weight (lbs)',
      length: 'Length (ft)',
      width: 'Width (ft)',
      height: 'Height (ft)',
      route: 'Route Description',
    },
    requiresVehicleInfo: true,
    typicalRestrictions: ['I-80 wind/weight rules'],
  },
}

/** Trip type for portal filing (not auto-matched for Annual yet). */
export type PortalTripType = 'Single trip' | 'Round trip' | 'Annual'

export const PORTAL_TRIP_TYPES: readonly PortalTripType[] = [
  'Single trip',
  'Round trip',
  'Annual',
] as const

export interface PrefillPackage {
  state: string
  loadDetails: any
  routeCorridor: string[]
  permitRequiredStates: string[]
  generatedFields: Record<string, any>
  humanApprovalRequired: boolean
  approvalNotes: string[]
}

/** Fallback labels when a key is not in config.fieldMapping. */
export const PREFILL_FIELD_LABELS: Record<string, string> = {
  origin: 'Origin',
  destination: 'Destination',
  weight: 'Gross Weight (lbs)',
  length: 'Overall Length (ft)',
  width: 'Overall Width (ft)',
  height: 'Overall Height (ft)',
  route: 'Proposed Route / Corridor',
  border_entry: 'Border Entry',
  border_exit: 'Border Exit',
  entry_point: 'Border Entry Point',
  exit_point: 'Border Exit Point',
  border_summary: 'Border Summary',
  border_role: 'Border Role',
  axles: 'Axles',
  vehicle_id: 'Vehicle / VIN',
  tractor_year: 'Tractor year',
  tractor_make: 'Tractor make',
  tractor_model: 'Tractor model',
  tractor_ymm: 'Tractor year/make/model',
  tractor_vin: 'Tractor VIN',
  tractor_plate: 'Tractor plate',
  tractor_plate_state: 'Tractor plate state',
  trailer_year: 'Trailer year',
  trailer_make: 'Trailer make',
  trailer_model: 'Trailer model',
  trailer_ymm: 'Trailer year/make/model',
  trailer_vin: 'Trailer VIN',
  trailer_plate: 'Trailer plate',
  trailer_plate_state: 'Trailer plate state',
  trailer_2_year: 'Trailer 2 year',
  trailer_2_make: 'Trailer 2 make',
  trailer_2_model: 'Trailer 2 model',
  trailer_2_ymm: 'Trailer 2 year/make/model',
  trailer_2_vin: 'Trailer 2 VIN',
  trailer_2_plate: 'Trailer 2 plate',
  trailer_2_plate_state: 'Trailer 2 plate state',
  carrier_company: 'Carrier Company',
  carrier_usdot: 'USDOT',
  carrier_mc: 'MC Number',
  carrier_phone: 'Carrier Phone',
  carrier_email: 'Carrier Email',
  driver_name: 'Driver',
  driver_cdl: 'Driver CDL',
  driver_cdl_state: 'Driver CDL State',
  driver_phone: 'Driver Phone',
  trip_type: 'Trip Type',
  rig_name: 'Rig Name',
  overhang: 'Overhang',
  front_overhang: 'Front Overhang',
  rear_overhang: 'Rear Overhang',
  trailer_length: 'Trailer / Load Length',
  load_description: 'Load Description',
  load_pieces: 'Load Pieces / How Many',
  serial_number: 'Serial Number',
  piece_width: 'Piece Width',
  piece_length: 'Piece Length',
  piece_height: 'Piece Height',
  power_unit_type: 'Power Unit Type',
  unit_two_type: 'Unit Two Type',
  highways: 'Highways',
  tip_conveyance: 'Conveyance',
  tip_description_list: 'Description list',
  tip_for_hire: 'For Hire',
  tip_travel: 'Travel',
  tip_vehicle_type: 'Vehicle Type',
  tip_power_unit_type: 'Power Unit Type tip',
  tip_booster: 'Booster unit',
  tip_piece_dims: 'Piece dims note',
  contact_name: 'Carrier contact name',
  special_notes: 'Special Notes',
}

/**
 * Discrete tractor/trailer identity keys for prefill grid + clipboard.
 * Primary trailer first; trailer_2_* only emitted when a second trailer has values.
 */
export const VEHICLE_IDENTITY_PREFILL_KEYS: readonly string[] = [
  'tractor_year',
  'tractor_make',
  'tractor_model',
  'tractor_ymm',
  'tractor_vin',
  'tractor_plate',
  'tractor_plate_state',
  'trailer_year',
  'trailer_make',
  'trailer_model',
  'trailer_ymm',
  'trailer_vin',
  'trailer_plate',
  'trailer_plate_state',
  'trailer_2_year',
  'trailer_2_make',
  'trailer_2_model',
  'trailer_2_ymm',
  'trailer_2_vin',
  'trailer_2_plate',
  'trailer_2_plate_state',
] as const

/** Join year/make/model with only present parts (e.g. "2019 Peterbilt 389"). */
export function formatVehicleYmm(
  year?: number | string | null,
  make?: string | null,
  model?: string | null
): string | null {
  const parts: string[] = []
  if (year != null && year !== '') {
    const n = Number(year)
    if (Number.isFinite(n) && n !== 0) parts.push(String(Math.trunc(n)))
    else if (typeof year === 'string' && year.trim()) parts.push(year.trim())
  }
  const mk = make != null ? String(make).trim() : ''
  const md = model != null ? String(model).trim() : ''
  if (mk) parts.push(mk)
  if (md) parts.push(md)
  return parts.length ? parts.join(' ') : null
}

function pickVehicleField(obj: Record<string, any>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = obj?.[key]
    if (val == null || val === '') continue
    const s = String(val).trim()
    if (s) return s
  }
  return null
}

/**
 * Emit discrete identity keys for tractor / trailer / trailer_2 into generatedFields.
 * Only sets keys that have values. Does not use trailer_type as manufacturer make.
 */
function emitVehicleIdentityFields(
  generated: Record<string, any>,
  prefix: 'tractor' | 'trailer' | 'trailer_2',
  vehicle: Record<string, any> | null | undefined
): void {
  if (!vehicle || typeof vehicle !== 'object') return

  const yearRaw = vehicle.year
  let yearOut: number | string | null = null
  if (yearRaw != null && yearRaw !== '') {
    const n = Number(yearRaw)
    if (Number.isFinite(n) && n !== 0) yearOut = Math.trunc(n)
    else if (typeof yearRaw === 'string' && yearRaw.trim()) yearOut = yearRaw.trim()
  }
  // Manufacturer make only — never fall back to trailer_type (equipment class)
  const make = pickVehicleField(vehicle, 'make')
  const model = pickVehicleField(vehicle, 'model')
  const vin = pickVehicleField(vehicle, 'vin')
  const plate = pickVehicleField(vehicle, 'license_plate', 'licensePlate')
  const plateState = pickVehicleField(
    vehicle,
    'license_plate_state',
    'licensePlateState'
  )
  const ymm = formatVehicleYmm(yearOut, make, model)

  if (yearOut != null) generated[`${prefix}_year`] = yearOut
  if (make) generated[`${prefix}_make`] = make
  if (model) generated[`${prefix}_model`] = model
  if (ymm) generated[`${prefix}_ymm`] = ymm
  if (vin) generated[`${prefix}_vin`] = vin
  if (plate) generated[`${prefix}_plate`] = plate.toUpperCase()
  if (plateState) generated[`${prefix}_plate_state`] = plateState.toUpperCase()
}

export type CompletenessStatus = 'pass' | 'warn'

export interface CompletenessItem {
  id: string
  label: string
  status: CompletenessStatus
  /** Short fix hint when status is warn. */
  hint?: string
  /** Soft notes (e.g. optional year/make/model) — not counted in hard "to fix". */
  soft?: boolean
}

export interface CompletenessChecklist {
  items: CompletenessItem[]
  passCount: number
  /** Hard warn count only (excludes soft notes) — used for "to fix" summary. */
  warnCount: number
  /** Soft optional notes (do not block ready). */
  softWarnCount: number
  /** True when every hard item passes (soft notes ignored). */
  ready: boolean
}

export interface ClipboardPacketOptions {
  tripType?: PortalTripType
}

export interface CompletenessChecklistContext {
  /** Override multi-state detection (default: routeCorridor length > 1). */
  multiState?: boolean
}

// ---------------------------------------------------------------------------
// Missouri (MoDOT Carrier Express) Portal Assist playbook v3 — pure helpers
// Application enums + Trip → Review → Payment + multi-state pay-last.
// Static inventory lives in lib/portal-playbooks/mo.ts (PortalPlaybook schema).
// Field order/labels locked from live Carrier Express Single Trip screens.
// NOT browser RPA / auto-click into MoDOT.
// ---------------------------------------------------------------------------

/** Application-tip + copyable-value keys in MoDOT Single Trip packet order. */
export const MO_PORTAL_FIELD_ORDER: readonly string[] = MO_PLAYBOOK_FIELD_ORDER

/** Prefill keys copied for MO Step 2 Application fields. */
export const MO_APPLICATION_PREFILL_KEYS: readonly string[] =
  MO_PLAYBOOK.applicationKeys ?? []

/** Prefill keys copied for MO Trip tab guidance (borders multi-state only). */
export const MO_TRIP_TAB_PREFILL_KEYS: readonly string[] = MO_PLAYBOOK.tripKeys ?? []

/** Prefill keys for Payment step (carrier contact first; driver only if no carrier contact). */
export const MO_PAYMENT_PREFILL_KEYS: readonly string[] = MO_PLAYBOOK.paymentKeys ?? []

/** Border keys omitted from trip-tab prefill when single-state. */
export const MO_BORDER_PREFILL_KEYS: readonly string[] = MO_PLAYBOOK.borderKeys ?? []

/**
 * Multi-state pay-last banner: validate other corridor states before MoDOT Submit/pay.
 */
export const MO_PAY_LAST_NOTE =
  (MO_PLAYBOOK.notes?.payLast as string) ||
  'Validate other corridor states before Submit/pay when multi-state'

/**
 * Fee honesty: amounts shown in UI (e.g. ~$15 single trip) are MoDOT-displayed — not TruckerOS truth.
 */
export const MO_FEE_DISPLAY_NOTE =
  (MO_PLAYBOOK.notes?.feeDisplay as string) ||
  'Fee is MoDOT-displayed on Payment (single trip may show ~$15 — confirm in MoDOT; TruckerOS is not sole fee truth)'

/** Conveyance enum tip (live Single Trip options + default). */
export const MO_CONVEYANCE_TIP =
  (MO_PLAYBOOK.notes?.conveyance as string) ||
  'Hauled (default for typical trailer load) — options: Under Own Power | Towed | Hauled | Haul/Tow'

/** Description list tip: OTHER then free-text Load Description. */
export const MO_DESCRIPTION_LIST_TIP =
  (MO_PLAYBOOK.notes?.descriptionList as string) ||
  'OTHER — then free-text Load Description'

/** Power Unit Type enum tip (default TRUCK-TRACTOR for tractor). */
export const MO_POWER_UNIT_TYPE_TIP =
  (MO_PLAYBOOK.notes?.powerUnitType as string) ||
  'TRUCK-TRACTOR (default for tractor) — options: TRUCK-TRACTOR | TRUCK | AUTOMOBILE'

/** MoDOT-oriented portal labels for MO packet / resolvePortalFieldLabel. */
export const MO_PORTAL_FIELD_LABELS: Record<string, string> = {
  ...MO_PLAYBOOK_FIELD_LABELS,
}

/**
 * Path-note walkthrough (mirrors buildMoFilingSteps titles — single source of path truth is steps).
 * Prefill often has city/state only; MoDOT Trip map may still require Street Address entry.
 * Copy-assist only — no RPA / auto-click.
 */
export const MO_PORTAL_WALKTHROUGH: readonly string[] = MO_PLAYBOOK.walkthrough ?? []

export function isMissouriPortal(
  stateCode?: string | null,
  config?: PortalStateConfig | null
): boolean {
  if (stateCode && String(stateCode).trim().toUpperCase() === 'MO') return true
  if (config?.portalUrl && /modot\.mo\.gov/i.test(config.portalUrl)) return true
  if (config?.portalSystemName && /carrier express/i.test(config.portalSystemName)) {
    return true
  }
  return false
}

/** MO field order for packet / UI (copy of constant for callers that prefer a function). */
export function getMoPortalFieldOrder(): readonly string[] {
  return MO_PORTAL_FIELD_ORDER
}

/** Resolve MoDOT label for a prefill key; falls back to shared labels. */
export function getMoPortalFieldLabel(key: string): string {
  return MO_PORTAL_FIELD_LABELS[key] || PREFILL_FIELD_LABELS[key] || key
}

export interface MoFilingStep {
  id: string
  stepNumber: number
  title: string
  /** Prefill keys whose values are copied for this step (may be empty). */
  prefillKeys: string[]
  /** Operator guidance under the step (enum options, Analyze checklist, pay-last). */
  guidance?: string[]
}

/**
 * Multi-state signal for MO playbook (corridor 2+ codes or origin≠dest).
 * Matches buildPortalCompletenessChecklist multi-state detection.
 */
export function isMoMultiStatePrefill(prefill?: PrefillPackage | null): boolean {
  if (!prefill) return false
  const corridorCodes = (prefill.routeCorridor || [])
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
  if (corridorCodes.length > 1) return true
  const load = prefill.loadDetails || {}
  const originSt = String(load.origin_state ?? '').trim().toUpperCase()
  const destSt = String(load.destination_state ?? '').trim().toUpperCase()
  return (
    !!originSt &&
    !!destSt &&
    originSt !== destSt &&
    !/^(UNDEFINED|NULL)$/.test(originSt) &&
    !/^(UNDEFINED|NULL)$/.test(destSt)
  )
}

/**
 * Count cargo trailers only (skip jeep/booster/dolly) for MoDOT Vehicle Type tip.
 * Prefers cargo_trailer_count when set; else non-booster trailers from equipment; else primary identity.
 * Clamped to 1–2 for known Unit tips (MoDOT Vehicle Type: +1 / +2 Units).
 */
export function countMoCargoTrailers(
  prefill?: PrefillPackage | null,
  request?: any
): number {
  const fields = prefill?.generatedFields || {}
  const cargoCount = Number(fields.cargo_trailer_count)
  if (Number.isFinite(cargoCount) && cargoCount >= 0) {
    return Math.trunc(cargoCount)
  }
  const equip = request?.equipment || prefill?.loadDetails?.equipment || {}
  const rig = equip?.rig as Record<string, any> | undefined
  const trailers = Array.isArray(rig?.trailers) ? (rig!.trailers as Record<string, any>[]) : []
  if (trailers.length > 0) {
    const cargo = trailers.filter((tr) => !isBoosterLikeTrailer(tr))
    // All booster-like → treat primary pick as 1 unit if any trailer exists
    if (cargo.length > 0) return cargo.length
    return trailers.length > 0 ? 1 : 0
  }
  // Fall back to primary Unit Two identity only (not trailer_count which includes jeep)
  if (
    hasPrefillValue(fields.trailer_make) ||
    hasPrefillValue(fields.trailer_vin) ||
    hasPrefillValue(fields.trailer_plate) ||
    hasPrefillValue(fields.trailer_year) ||
    hasPrefillValue(fields.unit_two_type)
  ) {
    return 1
  }
  return 0
}

/**
 * MoDOT Vehicle Type tip from tractor + cargo-trailer count (jeep/booster excluded).
 * tractor + 1 cargo → "PowerUnit + 1 Unit"; tractor + 2 cargo → "PowerUnit + 2 Units" (max).
 * Empty string when equipment is unknown (omit from packet).
 */
export function buildMoVehicleTypeTip(
  prefill?: PrefillPackage | null,
  request?: any
): string {
  const fields = prefill?.generatedFields || {}
  // Tractor: discrete power-unit fields only (vehicle_id may be trailer VIN)
  const hasTractor =
    hasPrefillValue(fields.tractor_make) ||
    hasPrefillValue(fields.tractor_vin) ||
    hasPrefillValue(fields.tractor_year) ||
    hasPrefillValue(fields.tractor_plate) ||
    hasPrefillValue(fields.tractor_model) ||
    hasPrefillValue(fields.tractor_ymm)
  const cargoN = countMoCargoTrailers(prefill, request)
  const hasTrailer = cargoN >= 1

  if (hasTractor && hasTrailer) {
    // MoDOT list: PowerUnit + 1 Unit | + 2 Units | + 3 Units — clamp known cargo to 2
    const n = Math.min(Math.max(cargoN, 1), 2)
    return n === 1 ? 'PowerUnit + 1 Unit' : `PowerUnit + ${n} Units`
  }
  if (hasTractor) return 'PowerUnit'
  if (hasTrailer) return cargoN >= 2 ? '2 Units' : '1 Unit'
  // Unknown configuration — omit tip rather than invent PowerUnit + 1 Unit
  return ''
}

/**
 * Payment contact name: prefer carrier contact / company over driver.
 * Driver is last-resort fallback only when no carrier identity name exists.
 */
export function buildMoContactName(
  carrierDriver?: Record<string, any> | null
): string | null {
  if (!carrierDriver || typeof carrierDriver !== 'object') return null
  const carrierContact =
    pickEquipmentField(
      carrierDriver,
      'contactName',
      'contact_name',
      'carrierContactName',
      'carrier_contact_name'
    ) || null
  if (carrierContact) return String(carrierContact).trim()
  const company = pickEquipmentField(carrierDriver, 'companyName', 'company_name') || null
  if (company) return String(company).trim()
  const driver =
    pickEquipmentField(carrierDriver, 'driverFullName', 'driver_full_name') || null
  if (driver) return String(driver).trim()
  return null
}

/**
 * Travel tip: multi-state corridor → Interstate commerce; only MO → Intrastate travel within MO.
 * Multi-state signal matches isMoMultiStatePrefill (corridor > 1 OR origin≠dest).
 */
export function buildMoTravelTip(
  prefill?: PrefillPackage | null,
  routeCorridor?: string[] | null
): string {
  const shell: PrefillPackage | null =
    prefill || routeCorridor
      ? {
          state: prefill?.state || 'MO',
          loadDetails: prefill?.loadDetails || {},
          routeCorridor: routeCorridor ?? prefill?.routeCorridor ?? [],
          permitRequiredStates: prefill?.permitRequiredStates || [],
          generatedFields: prefill?.generatedFields || {},
          humanApprovalRequired: false,
          approvalNotes: [],
        }
      : null
  if (isMoMultiStatePrefill(shell)) {
    return 'Interstate commerce crossing state line'
  }
  return 'Intrastate travel within MO'
}

/** Conveyance enum tip with live options + Hauled default. */
export function buildMoConveyanceTip(): string {
  return MO_CONVEYANCE_TIP
}

/** Description list tip: OTHER then free-text Load Description. */
export function buildMoDescriptionListTip(): string {
  return MO_DESCRIPTION_LIST_TIP
}

/** Power Unit Type enum tip (default TRUCK-TRACTOR for tractor). */
export function buildMoPowerUnitTypeTip(): string {
  return MO_POWER_UNIT_TYPE_TIP
}

/** True when trailer_type is jeep/booster/dolly (not primary cargo deck). */
export function isBoosterLikeTrailer(trailer: Record<string, any> | null | undefined): boolean {
  if (!trailer || typeof trailer !== 'object') return false
  const t = trailer.trailer_type ?? trailer.trailerType ?? trailer.type
  const role = classifyTrailerRole(t)
  if (role === 'jeep' || role === 'flip' || role === 'stinger') return true
  const n = normalizeTrailerTypeLabel(t).toLowerCase()
  return /\bbooster\b/.test(n) || /\bdolly\b/.test(n)
}

/**
 * Prefer primary cargo trailer for Unit Two (skip jeep/booster when a later trailer exists).
 */
export function pickPrimaryCargoTrailer(
  trailers: Record<string, any>[] | null | undefined
): Record<string, any> | null {
  if (!Array.isArray(trailers) || trailers.length === 0) return null
  const main = trailers.find((tr) => !isBoosterLikeTrailer(tr))
  return main || trailers[0]
}

/** Booster unit tip: Yes when equipment indicates jeep/booster/dolly; else No. */
export function buildMoBoosterTip(prefill?: PrefillPackage | null, request?: any): string {
  const equip = request?.equipment || prefill?.loadDetails?.equipment || {}
  const rig = equip?.rig as Record<string, any> | undefined
  const trailers = Array.isArray(rig?.trailers) ? rig!.trailers : []
  for (const tr of trailers) {
    if (isBoosterLikeTrailer(tr)) {
      return 'Yes (equipment indicates booster/jeep)'
    }
  }
  return 'No'
}

/**
 * Map equipment trailer_type to a MoDOT-style Unit Two Type label.
 * Specific deck types before generic RGN (e.g. "double drop" / lowboy before RGN).
 * Known maps: DOUBLE DROP / SINGLE DROP / FLAT BED / STEP DECK TRLR, etc.
 * Unmapped: raw trailer_type uppercased + "select closest on MoDOT list".
 */
export function mapTrailerTypeToMoLabel(trailerType: unknown): string | null {
  const raw = normalizeTrailerTypeLabel(trailerType)
  if (!raw) return null
  const n = raw.toLowerCase()
  // Deck / lowboy / drop types first — before generic RGN match
  if (n.includes('double drop') || n.includes('dbl drop')) return 'DOUBLE DROP TRLR'
  if (n.includes('single drop')) return 'SINGLE DROP TRLR'
  if (n.includes('lowboy') || n.includes('low boy')) return 'LOWBOY TRLR'
  if (n.includes('step deck') || n.includes('stepdeck')) return 'STEP DECK TRLR'
  // Live MoDOT list uses spaced "FLAT BED TRLR"
  if (n.includes('flatbed') || n.includes('flat bed')) return 'FLAT BED TRLR'
  if (n === 'rgn' || n.includes('removable gooseneck') || /\brgn\b/.test(n)) {
    return 'RGN'
  }
  if (/\bjeep\b/.test(n)) return 'JEEP'
  if (/\bflip\b/.test(n)) return 'FLIP AXLE'
  if (/\bstinger\b/.test(n)) return 'STINGER'
  // Unmapped: emit raw + tip to pick closest MoDOT list item
  return `${raw.toUpperCase()} — select closest on MoDOT list`
}

/**
 * Prefill keys for a step that currently have values (for Prefill: hints UI).
 * Filters empty keys so borders/tips don't clutter when absent.
 */
export function getMoStepPrefillKeysWithValues(
  prefill: PrefillPackage | null | undefined,
  step: MoFilingStep,
  options?: ClipboardPacketOptions
): string[] {
  if (!prefill || !step.prefillKeys.length) return []
  const fields = prefill.generatedFields || {}
  const tripType =
    options?.tripType ||
    (typeof fields.trip_type === 'string' && fields.trip_type
      ? fields.trip_type
      : 'Single trip')

  const resolveValue = (key: string): unknown => {
    if (key === 'trip_type') return tripType
    if (key === 'border_entry') return fields.border_entry || fields.entry_point
    if (key === 'border_exit') return fields.border_exit || fields.exit_point
    if (key === 'route') {
      if (hasPrefillValue(fields.route)) return String(fields.route).trim()
      const corridorJoin = (prefill.routeCorridor || [])
        .map((s) => String(s ?? '').trim())
        .filter(Boolean)
        .join(' → ')
      return corridorJoin || undefined
    }
    if (key === 'tip_vehicle_type' && !hasPrefillValue(fields.tip_vehicle_type)) {
      return buildMoVehicleTypeTip(prefill, prefill?.loadDetails)
    }
    if (key === 'tip_travel' && !hasPrefillValue(fields.tip_travel)) {
      return buildMoTravelTip(prefill)
    }
    if (key === 'tip_booster' && !hasPrefillValue(fields.tip_booster)) {
      return buildMoBoosterTip(prefill)
    }
    if (key === 'tip_conveyance' && !hasPrefillValue(fields.tip_conveyance)) {
      return buildMoConveyanceTip()
    }
    if (key === 'tip_description_list' && !hasPrefillValue(fields.tip_description_list)) {
      return buildMoDescriptionListTip()
    }
    if (key === 'tip_power_unit_type' && !hasPrefillValue(fields.tip_power_unit_type)) {
      // Only when tractor present (same rule as power_unit_type value)
      const hasTractor =
        hasPrefillValue(fields.tractor_make) ||
        hasPrefillValue(fields.tractor_vin) ||
        hasPrefillValue(fields.tractor_year) ||
        hasPrefillValue(fields.tractor_plate) ||
        hasPrefillValue(fields.power_unit_type)
      return hasTractor ? buildMoPowerUnitTypeTip() : undefined
    }
    if (key === 'tip_for_hire' && !hasPrefillValue(fields.tip_for_hire)) {
      return 'Yes (when for-hire carrier; override if private)'
    }
    if (key === 'contact_name' && !hasPrefillValue(fields.contact_name)) {
      const cd =
        (prefill.loadDetails as any)?.cargo?.carrierDriver ||
        (prefill.loadDetails as any)?.carrierDriver ||
        null
      return buildMoContactName(cd) || fields.carrier_company || undefined
    }
    return fields[key]
  }

  return step.prefillKeys.filter((key) => hasPrefillValue(resolveValue(key)))
}

/**
 * Numbered MoDOT Carrier Express filing steps (v3 live path).
 * Driven by PortalPlaybook (lib/portal-playbooks/mo.ts) when present.
 * Application enums → Trip (Street Address / Analyze) → Review → Payment (pay-last).
 * Trip guidance always shown; border keys only when multi-state.
 */
export function buildMoFilingSteps(prefill?: PrefillPackage | null): MoFilingStep[] {
  const multiState = isMoMultiStatePrefill(prefill)
  const playbook = getPlaybook('MO') || MO_PLAYBOOK

  return playbook.steps.map((step, i) => {
    const prefillKeys = resolveStepCopyKeys(step, multiState)
    const guidance = resolveStepTips(step, multiState)
    return {
      id: step.id,
      stepNumber: i + 1,
      title: resolveStepTitle(step, multiState),
      prefillKeys,
      ...(guidance.length > 0 ? { guidance } : {}),
    }
  })
}

/**
 * Plain-text packet for one MO filing step (label: value lines for step keys only).
 * Empty when the step has no prefill keys or no values present.
 */
export function buildMoFilingStepClipboard(
  prefill: PrefillPackage,
  step: MoFilingStep,
  options?: ClipboardPacketOptions
): string {
  const fields = prefill.generatedFields || {}
  const tripType =
    options?.tripType ||
    (typeof fields.trip_type === 'string' && fields.trip_type
      ? fields.trip_type
      : 'Single trip')
  const lines: string[] = []
  const seen = new Set<string>()

  const resolveValue = (key: string): unknown => {
    if (key === 'trip_type') return tripType
    if (key === 'border_entry') return fields.border_entry || fields.entry_point
    if (key === 'border_exit') return fields.border_exit || fields.exit_point
    if (key === 'route') {
      if (hasPrefillValue(fields.route)) return String(fields.route).trim()
      const corridorJoin = (prefill.routeCorridor || [])
        .map((s) => String(s ?? '').trim())
        .filter(Boolean)
        .join(' → ')
      return corridorJoin || undefined
    }
    if (key === 'tip_vehicle_type' && !hasPrefillValue(fields.tip_vehicle_type)) {
      return buildMoVehicleTypeTip(prefill, prefill.loadDetails)
    }
    if (key === 'tip_travel' && !hasPrefillValue(fields.tip_travel)) {
      return buildMoTravelTip(prefill)
    }
    if (key === 'tip_booster' && !hasPrefillValue(fields.tip_booster)) {
      return buildMoBoosterTip(prefill)
    }
    if (key === 'tip_conveyance' && !hasPrefillValue(fields.tip_conveyance)) {
      return buildMoConveyanceTip()
    }
    if (key === 'tip_description_list' && !hasPrefillValue(fields.tip_description_list)) {
      return buildMoDescriptionListTip()
    }
    if (key === 'tip_power_unit_type' && !hasPrefillValue(fields.tip_power_unit_type)) {
      const hasTractor =
        hasPrefillValue(fields.tractor_make) ||
        hasPrefillValue(fields.tractor_vin) ||
        hasPrefillValue(fields.tractor_year) ||
        hasPrefillValue(fields.tractor_plate) ||
        hasPrefillValue(fields.power_unit_type)
      return hasTractor ? buildMoPowerUnitTypeTip() : undefined
    }
    if (key === 'tip_for_hire' && !hasPrefillValue(fields.tip_for_hire)) {
      return 'Yes (when for-hire carrier; override if private)'
    }
    if (key === 'contact_name' && !hasPrefillValue(fields.contact_name)) {
      const cd =
        (prefill.loadDetails as any)?.cargo?.carrierDriver ||
        (prefill.loadDetails as any)?.carrierDriver ||
        null
      return buildMoContactName(cd) || fields.carrier_company || undefined
    }
    return fields[key]
  }

  for (const key of step.prefillKeys) {
    const value = resolveValue(key)
    if (!hasPrefillValue(value)) continue
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`${getMoPortalFieldLabel(key)}: ${String(value).trim()}`)
  }
  return lines.join('\n')
}

/** Geometry point used for portal border entry/exit copy-paste fields. */
export interface PortalBorderPoint {
  lat: number
  lon: number
  highway?: string
}

/** Minimal border-crossing shape accepted by portal prefill (matches Corridor BorderCrossing). */
export interface PortalBorderCrossing {
  fromState: string
  toState: string
  entry: PortalBorderPoint
  exit: PortalBorderPoint
}

export type StateBorderRole = 'origin' | 'destination' | 'through' | 'single' | 'unknown'

export interface StateBorderFields {
  role: StateBorderRole
  entryPoint: string
  exitPoint: string
  borderEntry: string
  borderExit: string
  borderSummary: string
}

/**
 * Formats a border geometry point for portal form fields.
 * Example: "36.99412,-94.61780 (I-44)"
 */
export function formatBorderPoint(point?: PortalBorderPoint | null): string {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return ''
  const coords = `${point.lat},${point.lon}`
  return point.highway ? `${coords} (${point.highway})` : coords
}

/**
 * Resolves entry/exit border fields for a single state within a multi-state corridor.
 * - single-state corridors: role `single`, empty points
 * - through states: entry (into state) + exit (leaving state)
 * - origin/destination: only the relevant side when crossings are available
 */
export function resolveStateBorderFields(
  stateCode: string,
  routeCorridor: string[],
  borderCrossings?: PortalBorderCrossing[] | null
): StateBorderFields {
  const state = (stateCode || '').trim().toUpperCase()
  const corridor = (routeCorridor || [])
    .map((s) => String(s || '').trim().toUpperCase())
    .filter(Boolean)
  const crossings = borderCrossings || []

  const empty = (role: StateBorderRole, summary: string): StateBorderFields => ({
    role,
    entryPoint: '',
    exitPoint: '',
    borderEntry: '',
    borderExit: '',
    borderSummary: summary,
  })

  if (!state) {
    return empty('unknown', 'No state selected')
  }

  if (corridor.length <= 1) {
    const isSingle = corridor.length === 1 && corridor[0] === state
    return empty(
      isSingle ? 'single' : 'unknown',
      isSingle ? 'Single-state corridor (no border crossings)' : 'No multi-state corridor for border points'
    )
  }

  const idx = corridor.indexOf(state)
  let role: StateBorderRole = 'unknown'
  if (idx === 0) role = 'origin'
  else if (idx === corridor.length - 1) role = 'destination'
  else if (idx > 0) role = 'through'

  // Prefer adjacency-relative crossings (handles re-entry better than first-match alone)
  const prevState = idx > 0 ? corridor[idx - 1] : undefined
  const nextState = idx >= 0 && idx < corridor.length - 1 ? corridor[idx + 1] : undefined
  const adjEnter = prevState
    ? crossings.find(
        (c) =>
          String(c.fromState || '').toUpperCase() === prevState &&
          String(c.toState || '').toUpperCase() === state
      )
    : undefined
  const adjLeave = nextState
    ? crossings.find(
        (c) =>
          String(c.fromState || '').toUpperCase() === state &&
          String(c.toState || '').toUpperCase() === nextState
      )
    : undefined
  const enterCrossing =
    adjEnter || crossings.find((c) => String(c.toState || '').toUpperCase() === state)
  const leaveCrossing =
    adjLeave || crossings.find((c) => String(c.fromState || '').toUpperCase() === state)

  let entryPoint = ''
  let exitPoint = ''

  if (role === 'origin') {
    // Starts in-state — exit is the outbound border into the next state only
    exitPoint = formatBorderPoint(leaveCrossing?.entry)
  } else if (role === 'destination') {
    entryPoint = formatBorderPoint(enterCrossing?.entry)
  } else if (role === 'through') {
    entryPoint = formatBorderPoint(enterCrossing?.entry)
    // Prefer the actual outbound border (enter next state); fall back to last point still in-state
    exitPoint = formatBorderPoint(leaveCrossing?.entry || enterCrossing?.exit)
  }

  const parts: string[] = [`Role: ${role}`]
  if (entryPoint) parts.push(`Entry: ${entryPoint}`)
  if (exitPoint) parts.push(`Exit: ${exitPoint}`)
  if (!entryPoint && !exitPoint) {
    if (crossings.length === 0) {
      parts.push('No geometry border crossings available')
    } else {
      parts.push('No matching border crossings for this state')
    }
  }

  return {
    role,
    entryPoint,
    exitPoint,
    borderEntry: entryPoint,
    borderExit: exitPoint,
    borderSummary: parts.join(' · '),
  }
}

/** Minimal shape from permit analysis (primary or route option). */
export interface PortalAnalysisSource {
  routeCorridor?: string[] | null
  permitRequiredStates?: string[] | null
}

function normalizeStateCode(code: string): string {
  return code.trim().toUpperCase()
}

function isUsStateCode(code: string): boolean {
  return /^[A-Z]{2}$/.test(code)
}

/**
 * Derives state codes whose portals should open for a route analysis.
 * Order: routeCorridor first (deduped), then permit-only states not in corridor.
 * Filters to states with entries in STATE_PORTAL_CONFIGS (49 states; HI excluded).
 */
export function getPortalStatesForAnalysis(primary: PortalAnalysisSource): string[] {
  const corridor = (primary.routeCorridor || [])
    .map(normalizeStateCode)
    .filter(isUsStateCode)

  const permitStates = (primary.permitRequiredStates || [])
    .map(normalizeStateCode)
    .filter(isUsStateCode)

  const seen = new Set<string>()
  const ordered: string[] = []

  for (const state of corridor) {
    if (!seen.has(state)) {
      seen.add(state)
      ordered.push(state)
    }
  }

  for (const state of permitStates) {
    if (!seen.has(state)) {
      seen.add(state)
      ordered.push(state)
    }
  }

  return ordered.filter((state) => state in STATE_PORTAL_CONFIGS)
}

/** First portal state to focus after approval / launch — corridor order, then origin_state, then TX. */
export function resolveInitialPortalState(request: {
  origin_state?: string | null
  route_corridor?: string[] | null
  permit_required_states?: string[] | null
}): string {
  const fromAnalysis = getPortalStatesForAnalysis({
    routeCorridor: request.route_corridor,
    permitRequiredStates: request.permit_required_states,
  })
  if (fromAnalysis.length > 0) return fromAnalysis[0]

  const origin = normalizeStateCode(request.origin_state || '')
  if (origin in STATE_PORTAL_CONFIGS) return origin

  return 'TX'
}

function formatPortalDimension(feet: number | null | undefined): string {
  if (feet == null || !Number.isFinite(Number(feet)) || Number(feet) <= 0) return ''
  return formatDimensionDisplay(Number(feet))
}

function formatPortalWeight(lbs: number | null | undefined): string | number {
  if (lbs == null || !Number.isFinite(Number(lbs)) || Number(lbs) <= 0) return ''
  return `${Math.round(Number(lbs)).toLocaleString()} lbs`
}

/**
 * Formats "City, ST" for portal prefill. Requires both city and state;
 * empty / null / "undefined" fragments → '' so checklist does not false-pass
 * on "undefined, TX", ", TX", or city-only.
 */
export function formatPortalCityState(city: unknown, state: unknown): string {
  const clean = (v: unknown): string => {
    if (v == null) return ''
    const t = String(v).trim()
    if (!t || /^(undefined|null)$/i.test(t)) return ''
    return t
  }
  const c = clean(city)
  const s = clean(state)
  if (!c || !s) return ''
  return `${c}, ${s}`
}

function pickEquipmentField(equip: Record<string, any>, ...keys: string[]): any {
  for (const key of keys) {
    const val = equip[key]
    if (val != null && val !== '') return val
  }
  return null
}

export interface OpenStatePortalsOptions {
  /** Delay between tab opens (ms). 0 = all synchronous in the same turn. Default 75. */
  staggerMs?: number
  /** Custom window.open implementation (for tests). */
  openTab?: (url: string, target: string) => void
}

/**
 * Opens each configured state portal in a new tab.
 * Use staggerMs: 0 when called synchronously inside a click handler to avoid popup blockers.
 */
export function openStatePortals(
  states: string[],
  options?: OpenStatePortalsOptions
): void {
  const staggerMs = options?.staggerMs ?? 75
  const openTab =
    options?.openTab ??
    ((url: string, target: string) => {
      window.open(url, target, 'noopener,noreferrer')
    })

  const entries = states
    .map((state) => {
      const config = STATE_PORTAL_CONFIGS[state]
      return config ? { state, url: config.portalUrl } : null
    })
    .filter((entry): entry is { state: string; url: string } => entry !== null)

  if (staggerMs <= 0) {
    entries.forEach(({ state, url }) => {
      openTab(url, `_truckeros_portal_${state}`)
    })
    return
  }

  entries.forEach(({ state, url }, index) => {
    if (index === 0) {
      openTab(url, `_truckeros_portal_${state}`)
    } else {
      setTimeout(() => {
        openTab(url, `_truckeros_portal_${state}`)
      }, index * staggerMs)
    }
  })
}

/**
 * Generates a structured prefill package for a specific state portal.
 * This is the core of the "auto-prefill" feature.
 */
export function generatePortalPrefill(
  request: any,
  stateCode: string,
  options?: { tripType?: PortalTripType }
): PrefillPackage {
  const config = STATE_PORTAL_CONFIGS[stateCode]
  if (!config) throw new Error(`Unsupported state: ${stateCode}`)

  const generated: Record<string, any> = {}

  // Map common fields (dimensions as clean X' Y" for portal copy-paste)
  generated.origin = formatPortalCityState(request.origin_city, request.origin_state)
  generated.destination = formatPortalCityState(
    request.destination_city,
    request.destination_state
  )
  generated.weight = formatPortalWeight(request.weight) || request.weight
  generated.length = formatPortalDimension(request.length) || request.length
  generated.width = formatPortalDimension(request.width) || request.width
  generated.height = formatPortalDimension(request.height) || request.height
  generated.trip_type = options?.tripType || 'Single trip'

  if (request.route_corridor) {
    const corridorJoin = (request.route_corridor as unknown[])
      .map((s) => String(s ?? '').trim())
      .filter(Boolean)
      .join(' → ')
    if (corridorJoin) generated.route = corridorJoin
  }

  // Geometry-aligned border entry/exit for this state's portal form
  const borderCrossings =
    request.border_crossings || request.borderCrossings || []
  const borderFields = resolveStateBorderFields(
    stateCode,
    request.route_corridor || [],
    borderCrossings
  )
  generated.border_role = borderFields.role
  generated.entry_point = borderFields.entryPoint
  generated.exit_point = borderFields.exitPoint
  generated.border_entry = borderFields.borderEntry
  generated.border_exit = borderFields.borderExit
  generated.border_summary = borderFields.borderSummary

  // Pull rich equipment/cargo snapshots from saved permit_request for accurate vehicle prefill
  const equip = request.equipment || {}
  const cargo = request.cargo || {}
  const rig = equip.rig as Record<string, any> | null | undefined

  if (rig) {
    if (rig.rigName) generated.rig_name = rig.rigName
    if (rig.overallLengthFt) {
      generated.rig_length = `${Number(rig.overallLengthFt).toFixed(1)} ft`
    }
    if (rig.totalAxles) generated.axles = rig.totalAxles

    const tractor = (rig.tractor || {}) as Record<string, any>
    const tractorId =
      tractor.unit_number ||
      tractor.unitNumber ||
      tractor.profile_name ||
      tractor.profileName
    const tractorVin = tractor.vin
    if (tractorId || tractorVin) {
      generated.vehicle_id = tractorId || tractorVin
      generated.tractor = tractor.profile_name || tractor.profileName || tractorId
    }
    if (tractor.num_axles || tractor.numAxles) {
      generated.tractor_axles = tractor.num_axles || tractor.numAxles
    }

    // Discrete power-unit identity (year/make/model/VIN/plate/state) for portal copy
    emitVehicleIdentityFields(generated, 'tractor', tractor)

    const trailers = Array.isArray(rig.trailers) ? rig.trailers : []
    if (trailers.length > 0) {
      generated.trailer_count = trailers.length
      // Cargo-only count for MoDOT Vehicle Type (excludes jeep/booster/dolly)
      const cargoTrailers = (trailers as Record<string, any>[]).filter(
        (tr) => !isBoosterLikeTrailer(tr)
      )
      generated.cargo_trailer_count =
        cargoTrailers.length > 0 ? cargoTrailers.length : trailers.length > 0 ? 1 : 0
      // Prefer primary cargo deck for Unit Two (skip jeep/booster when later trailer exists)
      const primary =
        pickPrimaryCargoTrailer(trailers as Record<string, any>[]) ||
        (trailers[0] as Record<string, any>)
      const trailerLen = primary.overall_length_ft ?? primary.overallLengthFt
      if (trailerLen) generated.trailer_length = `${Number(trailerLen).toFixed(1)} ft`
      const trailerVin = primary.vin
      if (trailerVin && !generated.vehicle_id) generated.vehicle_id = trailerVin
      // Primary cargo trailer identity keys (trailer_*)
      emitVehicleIdentityFields(generated, 'trailer', primary)
      // Second trailer: first other trailer with identity (often jeep when primary is main deck)
      const secondary = (trailers as Record<string, any>[]).find((tr) => tr !== primary)
      if (secondary) {
        emitVehicleIdentityFields(generated, 'trailer_2', secondary)
      }
      generated.trailers = trailers
        .map((tr: Record<string, any>, i: number) => {
          const name = tr.profile_name || tr.profileName || `Trailer ${i + 1}`
          const len = tr.overall_length_ft ?? tr.overallLengthFt
          const axles = tr.num_axles ?? tr.numAxles
          const bits = [name]
          if (len) bits.push(`${Number(len).toFixed(1)} ft`)
          if (axles) bits.push(`${axles} axles`)
          return bits.join(' — ')
        })
        .join('; ')
    }
  }

  // Legacy flat equipment fields (pre–rig snapshot saves)
  if (!generated.axles) {
    const axles = pickEquipmentField(equip, 'axles', 'total_axles', 'totalAxles')
    if (axles) generated.axles = axles
  }
  if (!generated.vehicle_id) {
    const vehicleId = pickEquipmentField(equip, 'unit_number', 'unitNumber', 'vin')
    if (vehicleId) generated.vehicle_id = vehicleId
  }
  const kingpin = pickEquipmentField(equip, 'kingpin_setting_in', 'kingpinSettingIn', 'kingpin')
  if (kingpin) generated.kingpin = kingpin

  const loadOverhangs = equip.loadOverhangs as Record<string, number> | undefined
  if (loadOverhangs) {
    const front = Number(loadOverhangs.frontOfRigFt || 0) + Number(loadOverhangs.frontOfTrailerFt || 0)
    const rear = Number(loadOverhangs.rearFt || 0)
    if (front || rear) generated.overhang = `front ${front} ft / rear ${rear} ft`
    if (front) generated.front_overhang = formatPortalDimension(front) || `${front} ft`
    if (rear) generated.rear_overhang = formatPortalDimension(rear) || `${rear} ft`
  } else {
    const frontRaw =
      cargo.overhang_front_ft ?? cargo.overhangFrontFt ?? cargo.front_overhang ?? null
    const rearRaw =
      cargo.overhang_rear_ft ?? cargo.overhangRearFt ?? cargo.rear_overhang ?? null
    if (frontRaw != null && frontRaw !== '' && Number(frontRaw) !== 0) {
      generated.front_overhang =
        formatPortalDimension(frontRaw) || `${frontRaw}`
    }
    if (rearRaw != null && rearRaw !== '' && Number(rearRaw) !== 0) {
      generated.rear_overhang = formatPortalDimension(rearRaw) || `${rearRaw}`
    }
    if (cargo.overhang && !generated.front_overhang && !generated.rear_overhang) {
      generated.overhang = cargo.overhang
    } else if (generated.front_overhang || generated.rear_overhang) {
      const bits: string[] = []
      if (generated.front_overhang) bits.push(`front ${generated.front_overhang}`)
      if (generated.rear_overhang) bits.push(`rear ${generated.rear_overhang}`)
      generated.overhang = bits.join(' / ')
    }
  }

  const trailerLen = pickEquipmentField(equip, 'trailer_length_ft', 'trailerLengthFt')
  if (trailerLen && !generated.trailer_length) {
    generated.trailer_length = `${Number(trailerLen).toFixed(1)} ft`
  }

  // Cargo: description, pieces, serial, piece dims (shared keys; used heavily by MO packet)
  const cargoDesc =
    pickEquipmentField(cargo, 'description', 'cargoDescription', 'load_description') ||
    null
  if (cargoDesc) generated.load_description = cargoDesc
  const serial =
    pickEquipmentField(cargo, 'serialNumber', 'serial_number', 'cargoSerialNumber') || null
  if (serial) generated.serial_number = serial
  const piecesRaw =
    cargo.numberOfPieces ?? cargo.number_of_pieces ?? cargo.pieces ?? cargo.load_pieces
  if (piecesRaw != null && piecesRaw !== '') {
    const n = Number(piecesRaw)
    generated.load_pieces = Number.isFinite(n) && n > 0 ? Math.trunc(n) : piecesRaw
  } else {
    // Default 1 piece when cargo snapshot exists but count omitted
    if (cargo && (cargoDesc || serial || cargo.load || cargo.envelope)) {
      generated.load_pieces = 1
    }
  }

  // Piece dims: clean numeric values only when cargo.load piece dims exist (no paste annotations).
  // Guidance when piece missing lives in tip_piece_dims (MO) — not in the value line.
  const loadSlice = (cargo.load || {}) as Record<string, any>
  const pieceLenRaw = loadSlice.lengthFt ?? loadSlice.length_ft ?? loadSlice.length
  const pieceWidRaw = loadSlice.widthFt ?? loadSlice.width_ft ?? loadSlice.width
  const pieceHtRaw = loadSlice.heightFt ?? loadSlice.height_ft ?? loadSlice.height
  let hasPieceDim = false
  if (pieceLenRaw != null && pieceLenRaw !== '' && Number(pieceLenRaw) !== 0) {
    generated.piece_length = formatPortalDimension(pieceLenRaw) || pieceLenRaw
    hasPieceDim = true
  }
  if (pieceWidRaw != null && pieceWidRaw !== '' && Number(pieceWidRaw) !== 0) {
    generated.piece_width = formatPortalDimension(pieceWidRaw) || pieceWidRaw
    hasPieceDim = true
  }
  if (pieceHtRaw != null && pieceHtRaw !== '' && Number(pieceHtRaw) !== 0) {
    generated.piece_height = formatPortalDimension(pieceHtRaw) || pieceHtRaw
    hasPieceDim = true
  }
  // Piece-dim guidance is MO tip-only (clean numeric piece values when present; no overall annotation in values)
  if (
    stateCode === 'MO' &&
    !hasPieceDim &&
    (cargoDesc || serial || cargo.load || cargo.envelope)
  ) {
    generated.tip_piece_dims =
      'Piece W/L/H not set on load — enter on MoDOT or use overall dims only if same as piece (do not paste overall into piece fields blindly)'
  }

  // Highways from corridor builder (portal trip guidance)
  const hwyList = Array.isArray(request.highways)
    ? (request.highways as unknown[])
        .map((h) => String(h ?? '').trim())
        .filter(Boolean)
    : []
  if (hwyList.length > 0) {
    generated.highways = hwyList.join(', ')
  }

  // Power unit type only when tractor identity is present (not trailer-only vehicle_id)
  const tractorObj = (rig?.tractor || null) as Record<string, any> | null
  const tractorPresent = !!(
    tractorObj &&
    (pickVehicleField(tractorObj, 'vin', 'make', 'model', 'unit_number', 'unitNumber', 'license_plate', 'licensePlate') ||
      (tractorObj.year != null && tractorObj.year !== '' && Number(tractorObj.year) !== 0) ||
      hasPrefillValue(generated.tractor_vin) ||
      hasPrefillValue(generated.tractor_make) ||
      hasPrefillValue(generated.tractor_year) ||
      hasPrefillValue(generated.tractor_plate))
  )
  if (tractorPresent) {
    const tractorType =
      pickVehicleField(tractorObj || {}, 'vehicle_type', 'vehicleType', 'type') || null
    generated.power_unit_type = tractorType
      ? String(tractorType).trim()
      : 'TRUCK-TRACTOR'
  }

  // Unit Two Type from primary cargo trailer_type (skip jeep-first configs)
  if (rig) {
    const trailers = Array.isArray(rig.trailers) ? (rig.trailers as Record<string, any>[]) : []
    const primary = pickPrimaryCargoTrailer(trailers)
    if (primary) {
      const tType = primary.trailer_type ?? primary.trailerType ?? primary.type
      const mapped = mapTrailerTypeToMoLabel(tType)
      if (mapped) generated.unit_two_type = mapped
    }
  }

  const carrierDriver = (cargo.carrierDriver || {}) as Record<string, any>
  const carrierCompany = pickEquipmentField(carrierDriver, 'companyName', 'company_name')
  if (carrierCompany) generated.carrier_company = carrierCompany
  const carrierUsdot = pickEquipmentField(carrierDriver, 'usdotNumber', 'usdot_number')
  if (carrierUsdot) generated.carrier_usdot = carrierUsdot
  const carrierMc = pickEquipmentField(carrierDriver, 'mcNumber', 'mc_number')
  if (carrierMc) generated.carrier_mc = carrierMc
  const carrierPhone = pickEquipmentField(carrierDriver, 'carrierPhone', 'carrier_phone')
  if (carrierPhone) generated.carrier_phone = carrierPhone
  const carrierEmail = pickEquipmentField(carrierDriver, 'carrierEmail', 'carrier_email')
  if (carrierEmail) generated.carrier_email = carrierEmail
  const driverName = pickEquipmentField(carrierDriver, 'driverFullName', 'driver_full_name')
  if (driverName) generated.driver_name = driverName
  // Payment contact: carrier contact / company preferred over driver
  const contactName = buildMoContactName(carrierDriver)
  if (contactName) generated.contact_name = contactName
  const driverCdl = pickEquipmentField(carrierDriver, 'cdlNumber', 'cdl_number')
  if (driverCdl) generated.driver_cdl = driverCdl
  const driverCdlState = pickEquipmentField(carrierDriver, 'cdlState', 'cdl_state')
  if (driverCdlState) generated.driver_cdl_state = driverCdlState
  const driverPhone = pickEquipmentField(carrierDriver, 'driverPhone', 'driver_phone')
  if (driverPhone) generated.driver_phone = driverPhone

  // State-specific enhancements
  if (stateCode === 'TX') {
    generated.special_notes = 'Verify Houston Ship Channel clearances'
  }
  if (stateCode === 'IL') {
    generated.special_notes = 'Chicago metro weight analysis required'
  }
  if (stateCode === 'MO') {
    generated.special_notes = 'Missouri River bridge analysis recommended'
    // Application tips for MoDOT Step 2 (always present for MO packet) — v3 live enums
    generated.tip_conveyance = buildMoConveyanceTip()
    generated.tip_description_list = buildMoDescriptionListTip()
    generated.tip_for_hire = 'Yes (when for-hire carrier; override if private)'
    // Power unit type tip only when tractor present (same as power_unit_type value)
    if (tractorPresent) {
      generated.tip_power_unit_type = buildMoPowerUnitTypeTip()
    }
    // Temporary prefill shell for tip helpers (full package assembled below)
    const tipShell: PrefillPackage = {
      state: stateCode,
      loadDetails: request,
      routeCorridor: request.route_corridor || [],
      permitRequiredStates: request.permit_required_states || [],
      generatedFields: generated,
      humanApprovalRequired: false,
      approvalNotes: [],
    }
    generated.tip_travel = buildMoTravelTip(tipShell, request.route_corridor || [])
    const vehicleTip = buildMoVehicleTypeTip(tipShell, request)
    if (vehicleTip) generated.tip_vehicle_type = vehicleTip
    generated.tip_booster = buildMoBoosterTip(tipShell, request)
  }
  if (stateCode === 'GA') {
    generated.special_notes = 'Atlanta metro curfew check required'
  }
  if (stateCode === 'TN') {
    generated.special_notes = 'Cumberland mountain route clearances'
  }
  // special_notes only for the original 5 high-volume states (TX/IL/MO/GA/TN); the 42 added states use the generic request-derived path (all still produce valid prefill + use their fieldMapping for display)

  const approvalNotes: string[] = []
  let humanApprovalRequired = false

  if (request.permit_required_states?.length > 0) {
    humanApprovalRequired = true
    approvalNotes.push(`This load requires permits in ${request.permit_required_states.join(', ')}. Review all restrictions before submission.`)
  }

  return {
    state: stateCode,
    loadDetails: request,
    routeCorridor: request.route_corridor || [],
    permitRequiredStates: request.permit_required_states || [],
    generatedFields: generated,
    humanApprovalRequired,
    approvalNotes,
  }
}

/** True when a prefill field has a real value (rejects blank and "undefined"/null placeholders). */
export function hasPrefillValue(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return false
    // Reject location placeholders like "undefined, TX", "City, null", ", "
    if (/^(undefined|null)(\s*,\s*(undefined|null)?)?$/i.test(t)) return false
    if (/^(undefined|null)\s*,/i.test(t)) return false
    if (/,\s*(undefined|null)$/i.test(t)) return false
    if (t === ',' || t === ', ') return false
    return true
  }
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0
  return true
}

/** Meaningful non-empty route/corridor string (not only arrows/spaces). */
function hasMeaningfulRouteString(route: string): boolean {
  const t = route.trim()
  if (!t) return false
  return /[A-Za-z0-9]/.test(t)
}

/** Resolves portal field label: MO playbook labels, then config.fieldMapping, then fallbacks. */
export function resolvePortalFieldLabel(
  key: string,
  config?: PortalStateConfig | null,
  stateCode?: string | null
): string {
  if (isMissouriPortal(stateCode ?? null, config)) {
    if (MO_PORTAL_FIELD_LABELS[key]) return MO_PORTAL_FIELD_LABELS[key]
  }
  if (config?.fieldMapping?.[key]) return config.fieldMapping[key]
  return PREFILL_FIELD_LABELS[key] || key
}

/**
 * Builds a plain-text copy-paste packet for a state portal filing.
 * Lines: "{Portal field label}: {value}" using config.fieldMapping labels when available.
 * Always includes trip type; includes route/corridor when present even if not in fieldMapping;
 * includes border, axles, vehicle, carrier, driver when present.
 * Missouri uses MO field order + MoDOT-oriented labels (see MO_PORTAL_FIELD_ORDER).
 */
export function buildPortalClipboardPacket(
  prefill: PrefillPackage,
  config: PortalStateConfig,
  options?: ClipboardPacketOptions
): string {
  const fields = prefill.generatedFields || {}
  const tripType =
    options?.tripType ||
    (typeof fields.trip_type === 'string' && fields.trip_type
      ? fields.trip_type
      : 'Single trip')
  const lines: string[] = []
  const seen = new Set<string>()
  const mo = isMissouriPortal(prefill.state, config)

  const pushLine = (key: string, value: unknown, labelOverride?: string) => {
    if (!hasPrefillValue(value)) return
    if (seen.has(key)) return
    seen.add(key)
    const label =
      labelOverride ||
      resolvePortalFieldLabel(key, config, prefill.state)
    lines.push(`${label}: ${String(value).trim()}`)
  }

  const routeFromPrefillOrCorridor = (): string => {
    if (hasPrefillValue(fields.route)) return String(fields.route).trim()
    return (prefill.routeCorridor || [])
      .map((s) => String(s ?? '').trim())
      .filter(Boolean)
      .join(' → ')
  }

  // Missouri: fixed MoDOT-oriented order and labels
  if (mo) {
    for (const key of MO_PORTAL_FIELD_ORDER) {
      if (key === 'trip_type') {
        pushLine(key, tripType, getMoPortalFieldLabel(key))
        continue
      }
      if (key === 'route') {
        pushLine(key, routeFromPrefillOrCorridor(), getMoPortalFieldLabel(key))
        continue
      }
      if (key === 'border_entry') {
        pushLine(
          key,
          fields.border_entry || fields.entry_point,
          getMoPortalFieldLabel(key)
        )
        continue
      }
      if (key === 'border_exit') {
        pushLine(
          key,
          fields.border_exit || fields.exit_point,
          getMoPortalFieldLabel(key)
        )
        continue
      }
      pushLine(key, fields[key], getMoPortalFieldLabel(key))
    }
    return lines.join('\n')
  }

  // Mapped portal fields first (stable order from config.fieldMapping)
  for (const key of Object.keys(config.fieldMapping || {})) {
    pushLine(key, fields[key])
  }

  // Always include route/corridor when present (even if config omits route in fieldMapping)
  if (!seen.has('route')) {
    pushLine(
      'route',
      routeFromPrefillOrCorridor(),
      config.fieldMapping?.route || 'Route corridor'
    )
  }

  // Border entry/exit (prefer border_* aliases, fall back to entry/exit_point)
  const borderEntry = fields.border_entry || fields.entry_point
  const borderExit = fields.border_exit || fields.exit_point
  pushLine('border_entry', borderEntry, resolvePortalFieldLabel('border_entry', config))
  pushLine('border_exit', borderExit, resolvePortalFieldLabel('border_exit', config))

  // Vehicle / equipment extras when present (identity after axles, before carrier)
  pushLine('axles', fields.axles)
  for (const key of VEHICLE_IDENTITY_PREFILL_KEYS) {
    pushLine(key, fields[key])
  }
  pushLine('vehicle_id', fields.vehicle_id)

  // Carrier + driver when present
  pushLine('carrier_company', fields.carrier_company)
  pushLine('carrier_usdot', fields.carrier_usdot)
  pushLine('carrier_mc', fields.carrier_mc)
  pushLine('driver_name', fields.driver_name)

  // Trip type always present in packet
  pushLine('trip_type', tripType)

  return lines.join('\n')
}

/**
 * Completeness checklist for a portal filing kit (pass / warn only).
 * Missing items are warn with a short fix hint for the dispatcher.
 * Missouri tweaks: prefer USDOT when carrier is thin; axles when requiresVehicleInfo;
 * border checks for through / origin-exit / dest-entry roles (same roles as generic).
 */
export function buildPortalCompletenessChecklist(
  prefill: PrefillPackage,
  config: PortalStateConfig,
  context?: CompletenessChecklistContext
): CompletenessChecklist {
  const f = prefill.generatedFields || {}
  const corridorCodes = (prefill.routeCorridor || [])
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
  const load = prefill.loadDetails || {}
  const originSt = String(load.origin_state ?? '').trim().toUpperCase()
  const destSt = String(load.destination_state ?? '').trim().toUpperCase()
  const mo = isMissouriPortal(prefill.state, config)
  // Multi-state: corridor has 2+ codes, or origin≠dest, or explicit context
  const multiState =
    context?.multiState !== undefined
      ? context.multiState
      : corridorCodes.length > 1 ||
        (!!originSt &&
          !!destSt &&
          originSt !== destSt &&
          !/^(UNDEFINED|NULL)$/.test(originSt) &&
          !/^(UNDEFINED|NULL)$/.test(destSt))

  const items: CompletenessItem[] = []

  const add = (
    id: string,
    label: string,
    ok: boolean,
    hint: string,
    opts?: { soft?: boolean }
  ) => {
    items.push(
      ok
        ? { id, label, status: 'pass', soft: opts?.soft }
        : { id, label, status: 'warn', hint, soft: opts?.soft }
    )
  }

  add(
    'origin',
    mo ? 'Origin' : 'Origin',
    hasPrefillValue(f.origin),
    'Set origin city/state on the permit request'
  )
  add(
    'destination',
    mo ? 'Destination' : 'Destination',
    hasPrefillValue(f.destination),
    'Set destination city/state on the permit request'
  )

  const dimsOk =
    hasPrefillValue(f.weight) &&
    hasPrefillValue(f.length) &&
    hasPrefillValue(f.width) &&
    hasPrefillValue(f.height)
  add(
    'dimensions',
    mo ? 'GVW + Overall L/W/H' : 'Weight + L/W/H',
    dimsOk,
    'Add weight and overall L/W/H on the permit request'
  )

  if (multiState) {
    // Require a meaningful route string — do not treat corridor.length alone as pass
    const routeStr = hasPrefillValue(f.route)
      ? String(f.route).trim()
      : corridorCodes.join(' → ')
    const routeOk = hasMeaningfulRouteString(routeStr)
    add(
      'route',
      mo ? 'Route corridor' : 'Route corridor',
      routeOk,
      'Run analysis so route corridor is saved on the request'
    )
  }

  const role = String(f.border_role || '')
  const entryOk = hasPrefillValue(f.border_entry) || hasPrefillValue(f.entry_point)
  const exitOk = hasPrefillValue(f.border_exit) || hasPrefillValue(f.exit_point)
  if (role === 'through') {
    add(
      'border',
      mo ? 'MO entry & exit borders' : 'Border entry & exit',
      entryOk && exitOk,
      'Re-run analysis with geometry so border entry/exit populate for through states'
    )
  } else if (role === 'origin') {
    add(
      'border',
      mo ? 'MO exit border (origin state)' : 'Border exit (origin state)',
      exitOk,
      'Re-run analysis with geometry so origin exit border populates'
    )
  } else if (role === 'destination') {
    add(
      'border',
      mo ? 'MO entry border (destination state)' : 'Border entry (destination state)',
      entryOk,
      'Re-run analysis with geometry so destination entry border populates'
    )
  }

  // MO: prefer USDOT when carrier is thin (company alone is not enough)
  if (mo) {
    add(
      'carrier',
      'USDOT',
      hasPrefillValue(f.carrier_usdot),
      'Add USDOT on Profile / Permit Test carrier section'
    )
  } else {
    const carrierOk =
      hasPrefillValue(f.carrier_usdot) || hasPrefillValue(f.carrier_company)
    add(
      'carrier',
      'Carrier USDOT or company',
      carrierOk,
      'Add USDOT on Profile / Permit Test carrier section'
    )
  }

  if (config.requiresVehicleInfo) {
    // Warn when both VIN and plate are missing (unit number / vehicle_id still counts as pass)
    const hasVin =
      hasPrefillValue(f.tractor_vin) ||
      hasPrefillValue(f.trailer_vin) ||
      hasPrefillValue(f.trailer_2_vin)
    const hasPlate =
      hasPrefillValue(f.tractor_plate) ||
      hasPrefillValue(f.trailer_plate) ||
      hasPrefillValue(f.trailer_2_plate)
    const hasVehicleId = hasPrefillValue(f.vehicle_id)
    add(
      'vehicle',
      mo ? 'Power unit ID / VIN or plate' : 'Vehicle VIN or plate',
      hasVin || hasPlate || hasVehicleId,
      'Add VIN or license plate on equipment / rig (unit number also works)'
    )
    // Soft note when year/make/model are all empty on tractor and primary trailer
    const hasYmm =
      hasPrefillValue(f.tractor_year) ||
      hasPrefillValue(f.tractor_make) ||
      hasPrefillValue(f.tractor_model) ||
      hasPrefillValue(f.tractor_ymm) ||
      hasPrefillValue(f.trailer_year) ||
      hasPrefillValue(f.trailer_make) ||
      hasPrefillValue(f.trailer_model) ||
      hasPrefillValue(f.trailer_ymm)
    add(
      'vehicle_ymm',
      mo ? 'Power unit / trailer year-make-model' : 'Year / make / model',
      hasYmm,
      'Optional: add year, make, and model on tractor or trailer for portal forms',
      { soft: true }
    )
    // MO playbook: axles matter on Carrier Express when vehicle info is required
    if (mo) {
      add(
        'axles',
        'Number of Axles',
        hasPrefillValue(f.axles),
        'Add axle count on equipment / rig'
      )
    }
  }

  const passCount = items.filter((i) => i.status === 'pass').length
  // Soft notes still appear as warn items but are excluded from "to fix" / ready
  const hardWarnCount = items.filter(
    (i) => i.status === 'warn' && !i.soft
  ).length
  const softWarnCount = items.filter(
    (i) => i.status === 'warn' && !!i.soft
  ).length
  return {
    items,
    passCount,
    warnCount: hardWarnCount,
    softWarnCount,
    ready: hardWarnCount === 0,
  }
}

/**
 * Basic parser for portal output / confirmation text.
 * In a real implementation this would be more sophisticated (PDF parsing, email parsing, or scraping).
 */
export function parsePortalOutput(stateCode: string, rawText: string) {
  const lower = rawText.toLowerCase()
  const result: any = {
    state: stateCode,
    parsedAt: new Date().toISOString(),
    permitNumber: null,
    status: 'unknown',
    approvedDimensions: null,
    restrictions: [],
    fees: null,
    rawText: rawText.substring(0, 2000),
  }

  // Minimal corridor extractor (follows existing regex style) to support compare diffs for req #5.
  // Handles "Route: AL-MS-MO-IA-NE", "corridor AL→TN→MO", or standalone "AL MS MO IA NE".
  const routeMatch = rawText.match(/(?:route|corridor|path)[:\s]*([A-Z]{2}(?:\s*[-→]\s*[A-Z]{2})+)/i)
  if (routeMatch) {
    result.route_corridor = routeMatch[1].split(/[-→\s]+/).filter((s: string) => /^[A-Z]{2}$/.test(s)).map((s: string) => s.toUpperCase())
  } else {
    const seqMatch = rawText.match(/\b([A-Z]{2}(?:\s+[A-Z]{2}){2,})\b/)
    if (seqMatch) result.route_corridor = seqMatch[1].split(/\s+/).filter((s: string) => /^[A-Z]{2}$/.test(s)).map((s: string) => s.toUpperCase())
  }

  // Very basic regex-based extraction (improve per state later)
  const permitMatch = rawText.match(/permit\s*(?:number|#|id)[:\s]*([A-Z0-9-]+)/i)
  if (permitMatch) result.permitNumber = permitMatch[1]

  if (lower.includes('approved') || lower.includes('issued')) {
    result.status = 'approved'
  } else if (lower.includes('denied') || lower.includes('rejected')) {
    result.status = 'denied'
  } else if (lower.includes('review')) {
    result.status = 'under_review'
  }

  // Extract restrictions
  const restrictionMatches = rawText.match(/(?:restriction|curfew|bridge|height|weight)[^.!?]*[.!?]/gi)
  if (restrictionMatches) {
    result.restrictions = restrictionMatches.slice(0, 5)
  }

  return result
}

// Encryption helpers were moved to app/api/portal-credentials/route.ts
// (server-only) to avoid Turbopack client bundle errors.

// =============================================
// Week 2 Item 2: Enhanced Assisted Submission
// =============================================

export interface RouteComparison {
  ourCorridor: string[]
  portalCorridor: string[]
  similarity: number // 0-100
  differences: string[]
  recommendation: 'accept' | 'review' | 'reject'
  notes: string
}

export function compareRecommendedVsPortalRoute(
  ourCorridor: string[] | null,
  portalCorridor: string[] | null
): RouteComparison {
  const our = (ourCorridor || []).map(s => s.toUpperCase())
  const portal = (portalCorridor || []).map(s => s.toUpperCase())

  if (our.length === 0 || portal.length === 0) {
    return {
      ourCorridor: our,
      portalCorridor: portal,
      similarity: 0,
      differences: ['One or both routes are empty'],
      recommendation: 'review',
      notes: 'Insufficient data for comparison',
    }
  }

  // Simple Jaccard-like similarity
  const ourSet = new Set(our)
  const portalSet = new Set(portal)
  const intersection = new Set([...ourSet].filter(x => portalSet.has(x)))
  const union = new Set([...ourSet, ...portalSet])
  const similarity = Math.round((intersection.size / union.size) * 100)

  const differences: string[] = []
  our.forEach(state => {
    if (!portalSet.has(state)) differences.push(`Our route includes ${state} (not in portal)`)
  })
  portal.forEach(state => {
    if (!ourSet.has(state)) differences.push(`Portal suggests ${state} (not in our recommendation)`)
  })

  let recommendation: 'accept' | 'review' | 'reject' = 'accept'
  let notes = 'Routes are very similar.'

  if (similarity < 60) {
    recommendation = 'reject'
    notes = 'Significant route deviation detected. Human review strongly recommended.'
  } else if (similarity < 85 || differences.length > 1) {
    recommendation = 'review'
    notes = 'Minor differences found. Please review before final approval.'
  }

  return {
    ourCorridor: our,
    portalCorridor: portal,
    similarity,
    differences,
    recommendation,
    notes,
  }
}

export interface PortalSubmissionRecord {
  id?: string
  permit_request_id: string
  state_code: string
  status: 'initiated' | 'prefilled' | 'submitted' | 'approved' | 'rejected' | 'needs_correction' | string // string allows 'pdf-received' etc for status pills
  our_recommended_corridor: string[]
  portal_returned_corridor: string[] | null
  route_comparison: RouteComparison | null
  permit_number: string | null
  portal_fees: number | null
  portal_restrictions: string[]
  user_notes: string | null
  human_approved: boolean
  pdf_reference?: string | null // storage path or URL for uploaded portal PDF
  created_at?: string
}

// Creates a submission record (to be saved in DB later)
export function createPortalSubmissionRecord(
  permitRequestId: string,
  stateCode: string,
  prefill: PrefillPackage,
  portalOutput?: any,
  opts?: { humanApproved?: boolean; pdfReference?: string | null }
): PortalSubmissionRecord {
  const comparison = portalOutput?.route_corridor 
    ? compareRecommendedVsPortalRoute(prefill.routeCorridor, portalOutput.route_corridor)
    : null

  return {
    permit_request_id: permitRequestId,
    state_code: stateCode,
    status: portalOutput ? 'submitted' : 'prefilled',
    our_recommended_corridor: prefill.routeCorridor,
    portal_returned_corridor: portalOutput?.route_corridor || null,
    route_comparison: comparison,
    permit_number: portalOutput?.permitNumber || null,
    portal_fees: null,
    portal_restrictions: portalOutput?.restrictions || [],
    user_notes: null,
    human_approved: !!opts?.humanApproved,
    pdf_reference: opts?.pdfReference ?? null,
  }
}
