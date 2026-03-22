/**
 * DR Lookup Service
 *
 * Handles read-only lookups for DR acknowledgment:
 * - OneMap record fetch (BOSS API)
 * - Existing submission check (resubmission detection)
 * - Drops table fallback (DR imported from OES but not yet in 1Map)
 * - WhatsApp serial photo check
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';

import type {
  DropsTableRecord,
  ExistingSubmission,
  OneMapLookupResult,
  OneMapRecordResponse,
  WAPhotoCheck,
} from './types';

const logger = createLogger('activate/ack/drLookupService');

// BOSS API - Docker container on Velocity that caches 1Map photo data
const BOSS_API_HOST = process.env.BOSS_API_HOST || 'http://100.96.203.105:8003';

/**
 * Extract ONT serial from barcode scan data.
 *
 * Barcode format: (S)SERIAL(23S)CODE(20S)CODE(U)user(P)pass(ID)id(KY)key(N)model
 * We want just the serial after (S) and before the next (
 */
export function extractOntSerial(barcodeData: string | null): string | null {
  if (!barcodeData) return null;

  // Look for (S) pattern and extract the value after it
  const serialMatch = barcodeData.match(/\(S\)([^(]+)/);
  if (serialMatch && serialMatch[1]) {
    return serialMatch[1].trim();
  }

  // If no (S) pattern, check if it's just a plain serial (no parentheses)
  if (!barcodeData.includes('(')) {
    return barcodeData.trim();
  }

  return null;
}

/**
 * Fetch DR record from OneMap via BOSS API.
 *
 * Read-only query — does NOT trigger photo downloads.
 * Uses a 5-second abort timeout to avoid blocking the acknowledgment response.
 */
export async function fetchOneMapRecord(dropNumber: string): Promise<OneMapLookupResult> {
  const empty: OneMapLookupResult = { found: false, photoCount: 0, ontSerial: null, upsSerial: null };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${BOSS_API_HOST}/api/record/${dropNumber}`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = (await response.json()) as OneMapRecordResponse;
      const photoCount = data.photo_count || data.local_photos?.length || 0;
      const ontSerial = extractOntSerial(data.ont_barcode ?? null);
      const upsSerial = data.ups_serial || null;

      logger.info(`OneMap data for ${dropNumber}`, {
        photoCount,
        hasOnt: !!ontSerial,
        hasUps: !!upsSerial,
      });

      return { found: true, photoCount, ontSerial, upsSerial };
    }

    if (response.status === 404 || response.status === 422) {
      logger.info(`DR ${dropNumber} not found in OneMap`);
    } else {
      logger.warn(`OneMap returned ${response.status} for ${dropNumber}`);
    }

    return empty;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn(`OneMap timeout for ${dropNumber}`);
    } else {
      logger.warn(`OneMap query failed for ${dropNumber}`, { error });
    }
    // Continue with found=false — don't fail the acknowledgment
    return empty;
  }
}

/**
 * Check if DR already exists in our database (resubmission detection).
 *
 * IMPORTANT: A bare record created by updateOneMapStatus, process-new-dr, or OES import
 * is NOT a real resubmission. Only treat as resubmission if the DR has been through
 * QA review at least once (qa_decision set) or feedback was sent (feedback_message set).
 * Without this check, concurrent calls from Go Bridge cause false resubmission detection.
 * See: .claude/knowledge-base/activate/dr-acknowledgment-race-condition.md
 */
export async function checkExistingSubmission(dropNumber: string): Promise<ExistingSubmission | null> {
  try {
    const result = await pool.query(
      `SELECT submission_count, photo_count, feedback_message, qa_decision
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1`,
      [dropNumber]
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.warn(`Failed to check existing submission for ${dropNumber}`, { error });
    return null;
  }
}

/**
 * Check if DR exists in our drops table (imported from OES).
 *
 * Fallback when DR not found in 1Map — means DR is valid but sign-up not yet in 1Map.
 */
export async function checkDropsTable(dropNumber: string): Promise<DropsTableRecord | null> {
  try {
    const result = await pool.query(
      `SELECT d.drop_number, d.pole_number, d.project_id, p.project_name
       FROM drops d
       LEFT JOIN projects p ON d.project_id = p.id
       WHERE d.drop_number = $1
       LIMIT 1`,
      [dropNumber]
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.warn(`Failed to check drops table for ${dropNumber}`, { error });
    return null;
  }
}

/**
 * Check if DR has WhatsApp serial photos submitted.
 */
export async function checkWAPhotos(dropNumber: string): Promise<WAPhotoCheck> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM wa_photos
       WHERE drop_number = $1 AND purpose = 'activation'`,
      [dropNumber]
    );
    const count = parseInt(result.rows[0]?.count || '0', 10);
    return { hasPhoto: count > 0, photoCount: count };
  } catch (error) {
    logger.warn(`Failed to check WA photos for ${dropNumber}`, { error });
    return { hasPhoto: false, photoCount: 0 };
  }
}
