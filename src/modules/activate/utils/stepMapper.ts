/**
 * Step Mapper Utility
 *
 * Purpose: Bidirectional mapping between photo types (port 8003) and unified 10 steps
 * Status: WORKING - GREEN phase implementation
 *
 * 3-Phase QA Workflow (from wobbly-leaping-sparkle.md):
 * - Phase 1: Attribute-based categorization (instant, deterministic)
 * - Phase 2: VLM Quality Validation (AI checks against FiberTime spec)
 * - Phase 3: Human Review (card grid with approve/reject)
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
 * Steps 1-10: Required installation photos (all must be present)
 * Steps 11-12: Optional dome joint (handhole) photos
 *   - Step 11: Dome Joint Open (ph_hh1) — before closing
 *   - Step 12: Dome Joint Closed (ph_hh2) — after closing
 *
 * NOTE: ONT Barcode and UPS Serial are NOT photo steps - they are
 * scanned barcodes stored directly in ont_serial_scanned and ups_serial_scanned fields
 */

// ============================================================================
// CATEGORIZATION TYPES
// ============================================================================

/**
 * Source of categorization determination
 */
export type CategorizationSource = 'attribute' | 'filename' | 'unknown';

/**
 * Result of attribute-based photo categorization
 */
export interface CategorizationResult {
  /** Photo filename */
  filename: string;

  /** Assigned step number (1-12), null if unknown */
  step: number | null;

  /** Step label for display */
  stepLabel: string | null;

  /** Confidence score (0.0 - 1.0) */
  confidence: number;

  /** Source of categorization */
  source: CategorizationSource;

  /** Original type from OneMap (if available) */
  originalType: string | null;

  /** Extracted type from filename (if used) */
  extractedType: string | null;

  /** Whether this photo needs VLM categorization */
  needsVlmCategorization: boolean;
}

/**
 * Batch categorization result
 */
export interface BatchCategorizationResult {
  /** Total photos processed */
  total: number;

  /** Successfully categorized count */
  categorized: number;

  /** Photos needing VLM categorization */
  needsVlm: number;

  /** Individual results */
  results: CategorizationResult[];

  /** Processing time in milliseconds */
  processingTimeMs: number;
}

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
  'ph_cbl_r': 6,
  'ph_conn1': 6,  // ONT front panel / connections

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
  'ph_bl': 9,    // "blinking lights" — front panel with green indicator lights
  'ph_drop': 9,  // front panel showing DR number sticker + green lights

  // Step 10: Signature
  'ph_sign1': 10,
  'ph_sign2': 10,
  'ph_signature': 10,

  // Step 11: Dome Joint Open (Handhole before closing)
  'ph_hh1': 11,

  // Step 12: Dome Joint Closed (Handhole after closing)
  'ph_hh2': 12,
};

/**
 * Step Labels for Human-Readable Display (short)
 */
export const STEP_LABELS: Record<number, string> = {
  [-1]: 'Duplicate Photo',
  0: 'Discard - Rubbish',
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
  11: 'Dome Joint Open',
  12: 'Dome Joint Closed',
};

/**
 * Step Descriptions for Friendly Feedback Messages
 */
export const STEP_DESCRIPTIONS: Record<number, string> = {
  [-1]: 'Duplicate of another photo in this submission',
  0: 'Discarded as rubbish - not a valid installation photo',
  1: 'Photo of the house/property',
  2: 'Cable running from the pole',
  3: 'Cable entry point outside',
  4: 'Cable entry point inside',
  5: 'Wall installation area',
  6: 'ONT device back view',
  7: 'Power meter reading',
  8: 'Completed installation',
  9: 'Green lights on ONT with labels',
  10: 'Customer signature',
  11: 'Dome joint / handhole open before closing',
  12: 'Dome joint / handhole closed after sealing',
};

/**
 * Photo Rejection Reasons (Fibertime Quality Spec)
 *
 * Used when QA reviewer rejects a photo during categorization review.
 * These reasons align with Fibertime Build Standards quality criteria.
 */
export const PHOTO_REJECTION_REASONS = [
  { code: 'BLURRY', label: 'Blurry/Out of Focus' },
  { code: 'WRONG_ANGLE', label: 'Wrong Angle' },
  { code: 'WRONG_SUBJECT', label: 'Wrong Subject' },
  { code: 'POOR_LIGHTING', label: 'Poor Lighting' },
  { code: 'OBSTRUCTED', label: 'Obstructed View' },
  { code: 'DUPLICATE', label: 'Duplicate Photo' },
  { code: 'NOT_INSTALLATION', label: 'Not Installation Related' },
] as const;

export type PhotoRejectionReasonCode = typeof PHOTO_REJECTION_REASONS[number]['code'];

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
  6: ['ph_ont', 'ph_ont_back', 'ph_cbl_r', 'ph_conn1'],
  7: ['ph_powm', 'ph_powm1', 'ph_powm2'],
  8: ['ph_after', 'ph_final'],
  9: ['ph_lights', 'ph_led', 'ph_bl', 'ph_drop'],
  10: ['ph_sign1', 'ph_sign2', 'ph_signature'],
  11: ['ph_hh1'],
  12: ['ph_hh2'],
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

// ============================================================================
// PHASE 1: ATTRIBUTE-BASED CATEGORIZATION
// ============================================================================

/**
 * Filename pattern for extracting photo type
 * Matches: DR{number}_{type}_{sequence}.jpg
 * Example: DR1730550_ph_prop_001.jpg → ph_prop
 */
const FILENAME_PATTERN = /^DR\d+_([a-z_0-9]+)_\d+\.(?:jpg|jpeg|png)$/i;

/**
 * Extract photo type from filename
 *
 * @param filename - Photo filename (e.g., DR1730550_ph_prop_001.jpg)
 * @returns Extracted type (e.g., 'ph_prop') or null if pattern doesn't match
 */
export function extractTypeFromFilename(filename: string): string | null {
  if (!filename) return null;

  const match = filename.match(FILENAME_PATTERN);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }

  return null;
}

/**
 * Photo input for categorization
 */
export interface PhotoInput {
  /** Photo filename */
  filename: string;

  /** Original type from OneMap (optional) */
  original_type?: string | null;
}

/**
 * Categorize a single photo by attribute
 *
 * Phase 1 of the 3-Phase QA Workflow:
 * 1. Check original_type from OneMap → assign step (confidence: 1.0)
 * 2. Fallback: Extract type from filename pattern → assign step (confidence: 0.9)
 * 3. Unknown → flag for VLM categorization
 *
 * @param photo - Photo with filename and optional original_type
 * @returns Categorization result with step, confidence, and source
 *
 * @example
 * // OneMap type available (highest confidence)
 * categorizeByAttribute({ filename: 'DR1730550_ph_prop_001.jpg', original_type: 'ph_prop' })
 * // Returns: { step: 1, confidence: 1.0, source: 'attribute', needsVlmCategorization: false }
 *
 * // Fallback to filename extraction
 * categorizeByAttribute({ filename: 'DR1730550_ph_powm_001.jpg' })
 * // Returns: { step: 7, confidence: 0.9, source: 'filename', needsVlmCategorization: false }
 *
 * // Unknown type
 * categorizeByAttribute({ filename: 'unknown_photo.jpg' })
 * // Returns: { step: null, confidence: 0, source: 'unknown', needsVlmCategorization: true }
 */
export function categorizeByAttribute(photo: PhotoInput): CategorizationResult {
  const result: CategorizationResult = {
    filename: photo.filename,
    step: null,
    stepLabel: null,
    confidence: 0,
    source: 'unknown',
    originalType: photo.original_type ?? null,
    extractedType: null,
    needsVlmCategorization: true,
  };

  // Strategy 1: Use original_type from OneMap (highest confidence)
  if (photo.original_type) {
    const step = PHOTO_TYPE_TO_STEP[photo.original_type];
    if (step !== undefined) {
      result.step = step;
      result.stepLabel = STEP_LABELS[step] ?? null;
      result.confidence = 1.0;
      result.source = 'attribute';
      result.needsVlmCategorization = false;
      return result;
    }
  }

  // Strategy 2: Extract type from filename pattern (high confidence)
  const extractedType = extractTypeFromFilename(photo.filename);
  result.extractedType = extractedType;

  if (extractedType) {
    const step = PHOTO_TYPE_TO_STEP[extractedType];
    if (step !== undefined) {
      result.step = step;
      result.stepLabel = STEP_LABELS[step] ?? null;
      result.confidence = 0.9;
      result.source = 'filename';
      result.needsVlmCategorization = false;
      return result;
    }
  }

  // Strategy 3: Unknown - needs VLM categorization
  // Already initialized with needsVlmCategorization: true
  return result;
}

/**
 * Categorize multiple photos by attribute (batch operation)
 *
 * Processes all photos through Phase 1 categorization and returns
 * aggregated results with statistics.
 *
 * @param photos - Array of photos to categorize
 * @returns Batch result with statistics and individual results
 *
 * @example
 * const photos = [
 *   { filename: 'DR123_ph_prop_001.jpg', original_type: 'ph_prop' },
 *   { filename: 'DR123_ph_powm_001.jpg' },
 *   { filename: 'unknown.jpg' }
 * ];
 * const result = categorizeBatchByAttribute(photos);
 * // Returns: { total: 3, categorized: 2, needsVlm: 1, results: [...] }
 */
export function categorizeBatchByAttribute(photos: PhotoInput[]): BatchCategorizationResult {
  const startTime = Date.now();

  const results = photos.map((photo) => categorizeByAttribute(photo));

  const categorized = results.filter((r) => !r.needsVlmCategorization).length;
  const needsVlm = results.filter((r) => r.needsVlmCategorization).length;

  return {
    total: photos.length,
    categorized,
    needsVlm,
    results,
    processingTimeMs: Date.now() - startTime,
  };
}

/**
 * Get step coverage summary for a batch of photos
 *
 * Returns which steps are covered and which are missing.
 *
 * @param results - Array of categorization results
 * @returns Object with covered and missing step numbers
 */
export function getStepCoverage(results: CategorizationResult[]): {
  covered: number[];
  missing: number[];
  coverageMap: Record<number, CategorizationResult[]>;
} {
  const coverageMap: Record<number, CategorizationResult[]> = {};

  // Initialize empty arrays for all steps (1-10 required + 11-12 optional dome joint)
  for (let step = 1; step <= 12; step++) {
    coverageMap[step] = [];
  }

  // Group results by step
  for (const result of results) {
    if (result.step !== null) {
      const stepArray = coverageMap[result.step];
      if (stepArray) {
        stepArray.push(result);
      }
    }
  }

  const covered: number[] = [];
  const missing: number[] = [];

  // All 12 steps are required
  for (let step = 1; step <= 12; step++) {
    const stepPhotos = coverageMap[step];
    if (stepPhotos && stepPhotos.length > 0) {
      covered.push(step);
    } else {
      missing.push(step);
    }
  }

  return { covered, missing, coverageMap };
}
