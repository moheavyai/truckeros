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
//   1. Add entry to STATE_PORTAL_CONFIGS below: { name, portalUrl, loginUrl?, instructions, fieldMapping, requiresVehicleInfo?, typicalRestrictions? }
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

export interface PortalStateConfig {
  name: string
  portalUrl: string
  loginUrl?: string
  instructions: string
  fieldMapping: Record<string, string> // our field -> portal field label
  requiresVehicleInfo?: boolean
  typicalRestrictions?: string[]
}

export const STATE_PORTAL_CONFIGS: Record<string, PortalStateConfig> = {
  TX: {
    name: 'Texas (TxDOT)',
    portalUrl: 'https://www.txdmv.gov/motor-carriers/oversize-overweight-permits',
    loginUrl: 'https://txdot.gov/osow',
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
    loginUrl: 'https://caltrans.ca.gov/osow-portal',
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
    loginUrl: 'https://fdot.gov/osow',
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
    loginUrl: 'https://idot.gov/osow',
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
    loginUrl: 'https://modot.gov/osow',
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
    loginUrl: 'https://gdot.gov/osow-portal',
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
    loginUrl: 'https://tdot.tn.gov/osow',
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
  AK: {
    name: 'Alaska (AKDOT&PF)',
    portalUrl: 'https://dot.alaska.gov/permits/osow.shtml',
    loginUrl: 'https://alaska.gov/osow',
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
    loginUrl: 'https://aldot.gov/osow',
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
    loginUrl: 'https://ardot.gov/osow',
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
    loginUrl: 'https://azdot.gov/osow',
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
    loginUrl: 'https://codot.gov/osow',
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
  CT: {
    name: 'Connecticut (CTDOT)',
    portalUrl: 'https://portal.ct.gov/dot/permits/osow',
    loginUrl: 'https://ct.gov/osow',
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
    portalUrl: 'https://deldot.gov/permits/osow',
    loginUrl: 'https://deldot.gov/osow',
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
    portalUrl: 'https://itd.idaho.gov/permits/osow',
    loginUrl: 'https://itd.idaho.gov/osow',
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
  IN: {
    name: 'Indiana (INDOT)',
    portalUrl: 'https://www.in.gov/indot/permits/osow',
    loginUrl: 'https://indot.gov/osow',
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
    loginUrl: 'https://iowadot.gov/osow',
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
    portalUrl: 'https://www.ksdot.gov/permits/osow',
    loginUrl: 'https://ksdot.gov/osow',
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
    portalUrl: 'https://transportation.ky.gov/permits/osow',
    loginUrl: 'https://ky.gov/osow',
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
    portalUrl: 'https://www.dotd.la.gov/permits/osow',
    loginUrl: 'https://ladotd.gov/osow',
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
    portalUrl: 'https://www.maine.gov/mdot/permits/osow',
    loginUrl: 'https://maine.gov/osow',
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
    portalUrl: 'https://www.roads.maryland.gov/permits/osow',
    loginUrl: 'https://mdot.gov/osow',
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
    portalUrl: 'https://www.mass.gov/permits/osow',
    loginUrl: 'https://mass.gov/osow',
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
    portalUrl: 'https://www.michigan.gov/mdot/permits/osow',
    loginUrl: 'https://michigan.gov/osow',
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
    portalUrl: 'https://www.dot.state.mn.us/permits/osow',
    loginUrl: 'https://mndot.gov/osow',
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
    portalUrl: 'https://mdot.ms.gov/permits/osow',
    loginUrl: 'https://msdot.gov/osow',
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
    portalUrl: 'https://www.mdt.mt.gov/permits/osow',
    loginUrl: 'https://mdt.mt.gov/osow',
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
    portalUrl: 'https://dot.nebraska.gov/permits/osow',
    loginUrl: 'https://ndot.gov/osow',
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
    portalUrl: 'https://www.dot.nv.gov/permits/osow',
    loginUrl: 'https://ndot.nv.gov/osow',
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
    portalUrl: 'https://www.nh.gov/dot/permits/osow',
    loginUrl: 'https://nh.gov/osow',
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
    portalUrl: 'https://www.nj.gov/transportation/permits/osow',
    loginUrl: 'https://njdot.gov/osow',
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
  NM: {
    name: 'New Mexico (NMDOT)',
    portalUrl: 'https://www.dot.nm.gov/permits/osow',
    loginUrl: 'https://nmdot.gov/osow',
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
    portalUrl: 'https://www.dot.ny.gov/permits/osow',
    loginUrl: 'https://nysdot.gov/osow',
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
    loginUrl: 'https://ncdot.gov/osow',
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
    portalUrl: 'https://www.dot.nd.gov/permits/osow',
    loginUrl: 'https://nddot.gov/osow',
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
    portalUrl: 'https://www.transportation.ohio.gov/permits/osow',
    loginUrl: 'https://odot.gov/osow',
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
    portalUrl: 'https://www.odot.org/permits/osow',
    loginUrl: 'https://odot.org/osow',
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
    portalUrl: 'https://www.oregon.gov/odot/permits/osow',
    loginUrl: 'https://oregon.gov/osow',
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
    portalUrl: 'https://www.penndot.gov/permits/osow',
    loginUrl: 'https://penndot.gov/osow',
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
    portalUrl: 'https://www.dot.ri.gov/permits/osow',
    loginUrl: 'https://ridot.gov/osow',
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
    portalUrl: 'https://www.scdot.org/permits/osow',
    loginUrl: 'https://scdot.gov/osow',
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
    portalUrl: 'https://dot.sd.gov/permits/osow',
    loginUrl: 'https://sddot.gov/osow',
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
    portalUrl: 'https://www.udot.utah.gov/permits/osow',
    loginUrl: 'https://udot.gov/osow',
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
    portalUrl: 'https://vtrans.vermont.gov/permits/osow',
    loginUrl: 'https://vtrans.vermont.gov/osow',
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
  VA: {
    name: 'Virginia (VDOT)',
    portalUrl: 'https://www.vdot.virginia.gov/permits/osow',
    loginUrl: 'https://vdot.virginia.gov/osow',
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
    portalUrl: 'https://www.wsdot.wa.gov/permits/osow',
    loginUrl: 'https://wsdot.wa.gov/osow',
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
    portalUrl: 'https://transportation.wv.gov/permits/osow',
    loginUrl: 'https://wvdot.gov/osow',
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
    portalUrl: 'https://wisconsindot.gov/permits/osow',
    loginUrl: 'https://wisdot.gov/osow',
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
    portalUrl: 'https://www.dot.state.wy.us/permits/osow',
    loginUrl: 'https://wydot.gov/osow',
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

  // Map common fields
  generated.origin = `${request.origin_city}, ${request.origin_state}`
  generated.destination = `${request.destination_city}, ${request.destination_state}`
  generated.weight = request.weight
  generated.length = request.length
  generated.width = request.width
  generated.height = request.height

  if (request.route_corridor) {
    generated.route = request.route_corridor.join(' → ')
  }

  // Pull rich equipment/cargo snapshots from saved permit_request for accurate vehicle prefill
  // (axles, unit/vin, overhangs etc. matter for many portals that requireVehicleInfo)
  const equip = request.equipment || {}
  const cargo = request.cargo || {}
  if (equip.axles || equip.total_axles) {
    generated.axles = equip.axles || equip.total_axles
  }
  if (equip.unit_number || equip.vin) {
    generated.vehicle_id = equip.unit_number || equip.vin
  }
  if (equip.kingpin_setting_in || equip.kingpin) {
    generated.kingpin = equip.kingpin_setting_in
  }
  if (cargo.overhang_front_ft || cargo.overhang_rear_ft || cargo.overhang) {
    generated.overhang = cargo.overhang_front_ft || cargo.overhang_rear_ft || cargo.overhang
  }
  if (equip.trailer_length_ft) {
    generated.trailer_length = equip.trailer_length_ft
  }

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
