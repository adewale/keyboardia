/**
 * Browser presentation metadata for the runtime-neutral instrument catalogue.
 * Canonical IDs and names live in shared/instrument-catalog.ts.
 */
import {
  INSTRUMENT_GROUPS,
  INSTRUMENT_CATEGORY_ORDER,
  VALID_SAMPLE_IDS as CATALOG_SAMPLE_IDS,
  getInstrumentName as getCatalogInstrumentName,
} from '../shared/instrument-catalog';

export const INSTRUMENT_CATEGORIES = {
  drums: {
    ...INSTRUMENT_GROUPS.drums,
    color: '#e67e22',
    cssVar: '--color-drums',
  },
  bass: {
    ...INSTRUMENT_GROUPS.bass,
    color: '#9b59b6',
    cssVar: '--color-bass',
  },
  keys: {
    ...INSTRUMENT_GROUPS.keys,
    color: '#3498db',
    cssVar: '--color-keys',
  },
  leads: {
    ...INSTRUMENT_GROUPS.leads,
    color: '#e91e63',
    cssVar: '--color-leads',
  },
  pads: {
    ...INSTRUMENT_GROUPS.pads,
    color: '#2ecc71',
    cssVar: '--color-pads',
  },
  fx: {
    ...INSTRUMENT_GROUPS.fx,
    color: '#00bcd4',
    cssVar: '--color-fx',
  },
} as const;

// Category order for rendering
export const CATEGORY_ORDER = INSTRUMENT_CATEGORY_ORDER;

// Type definitions
export type InstrumentCategory = keyof typeof INSTRUMENT_CATEGORIES;
export type Instrument = typeof INSTRUMENT_CATEGORIES[InstrumentCategory]['instruments'][number];

// Helper to get display name for any instrument ID
export const getInstrumentName = getCatalogInstrumentName;

// Phase 31C: Helper to get category key for an instrument ID
export function getInstrumentCategory(id: string): InstrumentCategory | null {
  for (const [categoryKey, category] of Object.entries(INSTRUMENT_CATEGORIES)) {
    if (category.instruments.some(i => i.id === id)) {
      return categoryKey as InstrumentCategory;
    }
  }
  return null;
}

/**
 * Set of all valid sample/instrument IDs for validation
 * Used to validate session data before upload
 */
export const VALID_SAMPLE_IDS: Set<string> = CATALOG_SAMPLE_IDS;

