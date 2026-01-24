/**
 * API Endpoint: Sync Serial Data from dr-photo-api to onemap_properties
 *
 * This endpoint fetches ONT barcode and UPS serial data from the dr-photo-api
 * service (which gets it from 1Map GIS) and updates the onemap_properties table.
 *
 * dr-photo-api returns:
 *   - ont_barcode: from 1Map field ph_ont (ONT Barcode)
 *   - ups_serial: from 1Map field br_ser (Mini-UPS/Gizzu Serial)
 *
 * Usage:
 *   POST /api/onemap/sync-serials
 *   Body: { dropNumber: "DR12345678" } - Sync single drop
 *
 *   POST /api/onemap/sync-serials
 *   Body: { projectId: "abc123" } - Sync all drops for a project
 *
 * Related: Stage 3 of Site Stock Tracking implementation
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

// dr-photo-api endpoint (running on VF Server)
const DR_PHOTO_API_URL = process.env.DR_PHOTO_API_URL || 'http://100.96.203.105:8003';

// Response from dr-photo-api /api/record/{dr_number}
interface DrPhotoApiRecord {
  dr_number: string;
  site: string;
  site_name: string;
  status: string;
  address: string;
  photo_count: number;
  ont_barcode: string | null;
  ups_serial: string | null;
}

// Wrapper for our internal use
interface DrPhotoApiResponse {
  success: boolean;
  data?: DrPhotoApiRecord;
  error?: string;
}

interface SyncResult {
  dropNumber: string;
  success: boolean;
  ontBarcode?: string | null;
  upsSerial?: string | null;
  error?: string;
}

/**
 * Fetch serial data from dr-photo-api for a single drop
 */
async function fetchSerialDataFromApi(dropNumber: string): Promise<DrPhotoApiResponse> {
  try {
    // dr-photo-api uses /api/record/{dr_number} endpoint
    const response = await fetch(`${DR_PHOTO_API_URL}/api/record/${dropNumber}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `API returned ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();
    return {
      success: true,
      data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch from dr-photo-api',
    };
  }
}

/**
 * Update onemap_properties with serial data
 */
async function updateOnemapSerials(
  dropNumber: string,
  ontBarcode: string | null,
  upsSerial: string | null
): Promise<boolean> {
  try {
    // Check if record exists
    const existing = await sql`
      SELECT id FROM onemap_properties
      WHERE drop_number = ${dropNumber}
      LIMIT 1
    `;

    if (existing.length === 0) {
      // Create new record if doesn't exist
      await sql`
        INSERT INTO onemap_properties (drop_number, ont_barcode, ups_serial, created_at, updated_at)
        VALUES (${dropNumber}, ${ontBarcode}, ${upsSerial}, NOW(), NOW())
      `;
    } else {
      // Update existing record
      await sql`
        UPDATE onemap_properties
        SET ont_barcode = COALESCE(${ontBarcode}, ont_barcode),
            ups_serial = COALESCE(${upsSerial}, ups_serial),
            updated_at = NOW()
        WHERE drop_number = ${dropNumber}
      `;
    }

    return true;
  } catch (error) {
    console.error(`Error updating onemap_properties for ${dropNumber}:`, error);
    return false;
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  const { dropNumber, projectId, limit = 100 } = req.body;

  // Single drop sync
  if (dropNumber) {
    const apiResponse = await fetchSerialDataFromApi(dropNumber);

    if (!apiResponse.success || !apiResponse.data) {
      return res.status(400).json({
        success: false,
        error: apiResponse.error || 'Failed to fetch serial data',
        dropNumber,
      });
    }

    const { ont_barcode, ups_serial } = apiResponse.data;

    const updated = await updateOnemapSerials(dropNumber, ont_barcode, ups_serial);

    return res.status(200).json({
      success: updated,
      data: {
        dropNumber,
        ontBarcode: ont_barcode,
        upsSerial: ups_serial,
        updated,
      },
    });
  }

  // Batch sync for a project
  if (projectId) {
    // Get all drops from qa_photo_reviews for this project that need serial data
    const drops = await sql`
      SELECT DISTINCT q.drop_number
      FROM qa_photo_reviews q
      LEFT JOIN onemap_properties op ON q.drop_number = op.drop_number
      WHERE q.project = ${projectId}
        AND (op.ups_serial IS NULL OR op.ont_barcode IS NULL)
      LIMIT ${limit}
    `;

    const results: SyncResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const drop of drops) {
      const apiResponse = await fetchSerialDataFromApi(drop.drop_number);

      if (apiResponse.success && apiResponse.data) {
        const { ont_barcode, ups_serial } = apiResponse.data;
        const updated = await updateOnemapSerials(drop.drop_number, ont_barcode, ups_serial);

        results.push({
          dropNumber: drop.drop_number,
          success: updated,
          ontBarcode: ont_barcode,
          upsSerial: ups_serial,
        });

        if (updated) successCount++;
        else errorCount++;
      } else {
        results.push({
          dropNumber: drop.drop_number,
          success: false,
          error: apiResponse.error,
        });
        errorCount++;
      }

      // Small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        total: drops.length,
        successCount,
        errorCount,
        results,
      },
    });
  }

  return res.status(400).json({
    success: false,
    error: 'Either dropNumber or projectId is required',
  });
}

export default withAuth(fetchSerialDataFromApi);
