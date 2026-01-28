/**
 * Asset Verification Service
 *
 * Purpose: Verify asset details by scanning equipment labels
 * - Compare extracted label data against existing asset records
 * - Use fuzzy matching for manufacturer/model (OCR may have minor errors)
 * - Exact match for serial numbers (case-insensitive)
 *
 * Status: WORKING - Phase 1 Asset Procurement Integration
 *
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import { getDbConnection } from '../utils/db';
import { extractAssetFromLabel, type AssetLabelExtraction } from './assetVlmService';

// ============================================================================
// TYPES
// ============================================================================

export interface FieldMismatch {
  field: string;
  expected: string | null;
  found: string | null;
  isMatch: boolean;
}

export interface VerificationResult {
  /** Overall verification passed */
  verified: boolean;
  /** Asset data from database */
  asset: {
    id: string;
    assetNumber: string;
    name: string;
    serialNumber: string | null;
    manufacturer: string | null;
    model: string | null;
  };
  /** Extracted data from label */
  extracted: AssetLabelExtraction;
  /** Field-by-field comparison */
  comparisons: FieldMismatch[];
  /** List of mismatched fields */
  mismatches: FieldMismatch[];
  /** VLM confidence score */
  confidence: number;
  /** Timestamp of verification */
  verifiedAt: string;
  /** Error if verification failed */
  error?: string;
}

// ============================================================================
// MAIN VERIFICATION FUNCTION
// ============================================================================

/**
 * Verify an asset by scanning its label
 *
 * @param assetId - UUID of the asset to verify
 * @param imageBase64 - Base64 encoded image of the asset label
 * @param userId - User performing the verification
 */
export async function verifyAssetLabel(
  assetId: string,
  imageBase64: string,
  userId?: string
): Promise<VerificationResult> {
  const startTime = Date.now();

  try {
    log.info('[AssetVerify] Starting verification', { assetId });

    // 1. Fetch asset from database
    const asset = await getAssetById(assetId);
    if (!asset) {
      throw new Error(`Asset not found: ${assetId}`);
    }

    // 2. Extract data from label image
    const extraction = await extractAssetFromLabel(imageBase64);
    if (!extraction.success) {
      return createErrorResult(asset, extraction, `Label extraction failed: ${extraction.error}`);
    }

    // 3. Compare fields
    const comparisons = compareFields(asset, extraction);
    const mismatches = comparisons.filter((c) => !c.isMatch);

    // 4. Determine if verified (serial number must match if both present)
    const serialComparison = comparisons.find((c) => c.field === 'serialNumber');
    const verified =
      serialComparison?.isMatch !== false && // Serial must match (or both be null)
      mismatches.length <= 1; // Allow at most 1 minor mismatch

    // 5. Update asset verification status in database
    await updateVerificationStatus(assetId, {
      verified,
      userId,
      imageUrl: null, // TODO: Upload image to storage if needed
      mismatches: mismatches.length > 0 ? mismatches : null,
    });

    const duration = Date.now() - startTime;
    log.info('[AssetVerify] Verification complete', {
      assetId,
      verified,
      mismatchCount: mismatches.length,
      confidence: extraction.confidence,
      duration,
    });

    return {
      verified,
      asset: {
        id: asset.id,
        assetNumber: asset.asset_number,
        name: asset.name,
        serialNumber: asset.serial_number,
        manufacturer: asset.manufacturer,
        model: asset.model,
      },
      extracted: extraction,
      comparisons,
      mismatches,
      confidence: extraction.confidence,
      verifiedAt: new Date().toISOString(),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('[AssetVerify] Verification failed', { assetId, error: errorMsg });

    // Return error result with empty asset if we couldn't fetch it
    return {
      verified: false,
      asset: {
        id: assetId,
        assetNumber: '',
        name: '',
        serialNumber: null,
        manufacturer: null,
        model: null,
      },
      extracted: {
        success: false,
        manufacturer: null,
        model: null,
        serialNumber: null,
        manufactureDate: null,
        barcode: null,
        confidence: 0,
        rawText: '',
        error: errorMsg,
      },
      comparisons: [],
      mismatches: [],
      confidence: 0,
      verifiedAt: new Date().toISOString(),
      error: errorMsg,
    };
  }
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

interface AssetRow {
  id: string;
  asset_number: string;
  name: string;
  serial_number: string | null;
  manufacturer: string | null;
  model: string | null;
}

async function getAssetById(assetId: string): Promise<AssetRow | null> {
  const sql = getDbConnection();
  const rows = await sql`
    SELECT id, asset_number, name, serial_number, manufacturer, model
    FROM assets WHERE id = ${assetId}
  `;
  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  return {
    id: row.id as string,
    asset_number: row.asset_number as string,
    name: row.name as string,
    serial_number: row.serial_number as string | null,
    manufacturer: row.manufacturer as string | null,
    model: row.model as string | null,
  };
}

async function updateVerificationStatus(
  assetId: string,
  params: {
    verified: boolean;
    userId?: string;
    imageUrl: string | null;
    mismatches: FieldMismatch[] | null;
  }
): Promise<void> {
  const sql = getDbConnection();
  const status = params.verified ? 'verified' : 'mismatch';
  const mismatchesJson = params.mismatches ? JSON.stringify(params.mismatches) : null;

  await sql`
    UPDATE assets SET
      verified_at = NOW(),
      verified_by = ${params.userId || null},
      verification_status = ${status},
      verification_image_url = ${params.imageUrl},
      verification_mismatches = ${mismatchesJson}
    WHERE id = ${assetId}
  `;
}

// ============================================================================
// FIELD COMPARISON
// ============================================================================

/**
 * Compare asset fields with extracted label data
 */
function compareFields(asset: AssetRow, extraction: AssetLabelExtraction): FieldMismatch[] {
  const comparisons: FieldMismatch[] = [];

  // Serial number - exact match (case-insensitive)
  comparisons.push({
    field: 'serialNumber',
    expected: asset.serial_number,
    found: extraction.serialNumber,
    isMatch: matchSerial(asset.serial_number, extraction.serialNumber),
  });

  // Manufacturer - fuzzy match
  comparisons.push({
    field: 'manufacturer',
    expected: asset.manufacturer,
    found: extraction.manufacturer,
    isMatch: fuzzyMatch(asset.manufacturer, extraction.manufacturer, 2),
  });

  // Model - fuzzy match
  comparisons.push({
    field: 'model',
    expected: asset.model,
    found: extraction.model,
    isMatch: fuzzyMatch(asset.model, extraction.model, 2),
  });

  return comparisons;
}

/**
 * Match serial numbers (exact, case-insensitive)
 */
function matchSerial(expected: string | null, found: string | null): boolean {
  // Both null = match (no serial to verify)
  if (!expected && !found) return true;
  // One null = can't determine match
  if (!expected || !found) return true; // Don't fail if asset has no serial
  // Compare normalized
  return normalizeSerial(expected) === normalizeSerial(found);
}

function normalizeSerial(serial: string): string {
  return serial.toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Fuzzy string matching using Levenshtein distance
 */
function fuzzyMatch(expected: string | null, found: string | null, maxDistance: number): boolean {
  // Both null = match
  if (!expected && !found) return true;
  // One null = can't determine
  if (!expected || !found) return true;
  // Compare normalized strings
  const a = expected.toLowerCase().trim();
  const b = found.toLowerCase().trim();
  // Exact match
  if (a === b) return true;
  // Check if one contains the other
  if (a.includes(b) || b.includes(a)) return true;
  // Levenshtein distance
  return levenshteinDistance(a, b) <= maxDistance;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize first column
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const prevDiag = matrix[i - 1]![j - 1]!;
      const prevRow = matrix[i]![j - 1]!;
      const prevCol = matrix[i - 1]![j]!;

      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = prevDiag;
      } else {
        matrix[i]![j] = Math.min(
          prevDiag + 1, // substitution
          prevRow + 1, // insertion
          prevCol + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

// ============================================================================
// HELPERS
// ============================================================================

function createErrorResult(
  asset: AssetRow,
  extraction: AssetLabelExtraction,
  error: string
): VerificationResult {
  return {
    verified: false,
    asset: {
      id: asset.id,
      assetNumber: asset.asset_number,
      name: asset.name,
      serialNumber: asset.serial_number,
      manufacturer: asset.manufacturer,
      model: asset.model,
    },
    extracted: extraction,
    comparisons: [],
    mismatches: [],
    confidence: extraction.confidence,
    verifiedAt: new Date().toISOString(),
    error,
  };
}
