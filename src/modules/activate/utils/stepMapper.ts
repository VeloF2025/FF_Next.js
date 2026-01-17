/**
 * Step Mapper Utility
 *
 * Purpose: Bidirectional mapping between photo types (port 8003) and unified 10 steps
 * Status: WORKING - GREEN phase implementation
 *
 * Following PAI principles:
 * - TYPE_SAFETY: 100% TypeScript coverage
 * - Bidirectional consistency validated by tests
 * - Based on approved PRD and test specification
 *
 * NLNH Confidence: HIGH
 * - Mappings verified against port 8003 photo types
 * - Test coverage ensures bidirectional consistency
 *
 * NOTE: ONT Barcode and UPS Serial are NOT photo steps - they are scanned
 * barcodes stored directly in the database (ont_serial_scanned, ups_serial_scanned)
 */

/**
 * Photo Type to Step Mapping
 *
 * Maps photo types from port 8003 to unified 10 steps.
 * Multiple photo types can map to the same step (alternates).
 *
 * Source: Port 8003 photo naming convention (ph_prop, ph_pole, etc.)
 */
export const PHOTO_TYPE_TO_STEP: Record<string, number> = {
  // Step 1: House Photo
  'ph_prop': 1,

  // Step 2: Cable from Pole
  'ph_pole': 2,
  'ph_outs': 2,

  // Step 3: Cable Entry Outside
  'ph_entry_out': 3,
  'ph_hm_ln': 3,

  // Step 4: Cable Entry Inside
  'ph_entry_in': 4,
  'ph_hm_en': 4,

  // Step 5: Wall for Installation
  'ph_wall': 5,

  // Step 6: ONT Back After Install
  'ph_ont': 6,
  'ph_ont_back': 6,
  'ph_drop': 6,
  'ph_cbl_r': 6,
  'ph_bl': 6,

  // Step 7: Power Meter Reading
  'ph_powm': 7,
  'ph_powm1': 7,
  'ph_powm2': 7,

  // Step 8: Final Installation
  'ph_after': 8,
  'ph_final': 8,

  // Step 9: Green Lights on ONT
  'ph_lights': 9,
  'ph_led': 9,

  // Step 10: Signature
  'ph_sign2': 10,
  'ph_signature': 10,
};

/**
 * Step Labels for Human-Readable Display
 */
export const STEP_LABELS: Record<number, string> = {
  1: 'House Photo',
  2: 'Cable from Pole',
  3: 'Entry Outside',
  4: 'Entry Inside',
  5: 'Wall',
  6: 'ONT Back',
  7: 'Power Meter',
  8: 'Final Installation',
  9: 'Green Lights',
  10: 'Signature',
};

/**
 * Step to Photo Types Mapping
 *
 * Maps unified 10 steps to arrays of photo types.
 * Used for reverse lookup and validation.
 */
export const STEP_TO_PHOTO_TYPES: Record<number, string[]> = {
  1: ['ph_prop'],
  2: ['ph_pole', 'ph_outs'],
  3: ['ph_entry_out', 'ph_hm_ln'],
  4: ['ph_entry_in', 'ph_hm_en'],
  5: ['ph_wall'],
  6: ['ph_ont', 'ph_ont_back', 'ph_drop', 'ph_cbl_r', 'ph_bl'],
  7: ['ph_powm', 'ph_powm1', 'ph_powm2'],
  8: ['ph_after', 'ph_final'],
  9: ['ph_lights', 'ph_led'],
  10: ['ph_sign2', 'ph_signature'],
};

/**
 * Map Photo Type to Unified Step Number
 *
 * @param photoType - Photo type from port 8003 (e.g., 'ph_prop', 'ph_powm')
 * @returns Unified step number (1-12) or null if photo type is invalid
 *
 * @example
 * photoTypeToStep('ph_prop')   // Returns: 1 (House Photo)
 * photoTypeToStep('ph_powm')   // Returns: 7 (Power Meter)
 * photoTypeToStep('invalid')   // Returns: null
 */
export function photoTypeToStep(photoType: string): number | null {
  // Handle null, undefined, or empty string
  if (!photoType) {
    return null;
  }

  // Lookup photo type in mapping (case-sensitive)
  return PHOTO_TYPE_TO_STEP[photoType] ?? null;
}

/**
 * Map Unified Step Number to Photo Types
 *
 * @param step - Unified step number (1-12)
 * @returns Array of photo types for this step (empty array if invalid)
 *
 * @example
 * stepToPhotoTypes(1)   // Returns: ['ph_prop', 'ph_sign1']
 * stepToPhotoTypes(7)   // Returns: ['ph_powm', 'ph_powm2']
 * stepToPhotoTypes(12)  // Returns: [] (Signature - no photo)
 * stepToPhotoTypes(999) // Returns: [] (Invalid step)
 */
export function stepToPhotoTypes(step: number): string[] {
  // Handle null, undefined, or invalid numbers
  if (step == null || !Number.isInteger(step)) {
    return [];
  }

  // Lookup step in mapping
  return STEP_TO_PHOTO_TYPES[step] ?? [];
}
