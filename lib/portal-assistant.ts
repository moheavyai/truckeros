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
    portalSystemName: 'MoDOT MCS',
    instructions: 'Missouri OSOW Permitting. Use prefill for multi-state corridor loads; note Missouri River crossings and I-70 restrictions.',
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

export interface PrefillPackage {
  state: string
  loadDetails: any
  routeCorridor: string[]
  permitRequiredStates: string[]
  generatedFields: Record<string, any>
  humanApprovalRequired: boolean
  approvalNotes: string[]
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
  stateCode: string
): PrefillPackage {
  const config = STATE_PORTAL_CONFIGS[stateCode]
  if (!config) throw new Error(`Unsupported state: ${stateCode}`)

  const generated: Record<string, any> = {}

  // Map common fields (dimensions as clean X' Y" for portal copy-paste)
  generated.origin = `${request.origin_city}, ${request.origin_state}`
  generated.destination = `${request.destination_city}, ${request.destination_state}`
  generated.weight = formatPortalWeight(request.weight) || request.weight
  generated.length = formatPortalDimension(request.length) || request.length
  generated.width = formatPortalDimension(request.width) || request.width
  generated.height = formatPortalDimension(request.height) || request.height

  if (request.route_corridor) {
    generated.route = request.route_corridor.join(' → ')
  }

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

    const trailers = Array.isArray(rig.trailers) ? rig.trailers : []
    if (trailers.length > 0) {
      generated.trailer_count = trailers.length
      const primary = trailers[0] as Record<string, any>
      const trailerLen = primary.overall_length_ft ?? primary.overallLengthFt
      if (trailerLen) generated.trailer_length = `${Number(trailerLen).toFixed(1)} ft`
      const trailerVin = primary.vin
      if (trailerVin && !generated.vehicle_id) generated.vehicle_id = trailerVin
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
  } else if (cargo.overhang_front_ft || cargo.overhang_rear_ft || cargo.overhang) {
    generated.overhang = cargo.overhang_front_ft || cargo.overhang_rear_ft || cargo.overhang
  }

  const trailerLen = pickEquipmentField(equip, 'trailer_length_ft', 'trailerLengthFt')
  if (trailerLen && !generated.trailer_length) {
    generated.trailer_length = `${Number(trailerLen).toFixed(1)} ft`
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
