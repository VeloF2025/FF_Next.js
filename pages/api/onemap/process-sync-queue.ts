/**
 * API Endpoint: Process OneMap Serial Sync Queue
 *
 * POST /api/onemap/process-sync-queue
 *
 * Processes pending items in the onemap_sync_queue table.
 * This is called:
 * 1. By a lightweight cron job every 5 minutes (processes any pending items)
 * 2. Immediately after a DR is submitted (processes that specific DR)
 *
 * The queue approach ensures:
 * - Database trigger adds DR to queue immediately (no blocking)
 * - This endpoint processes queue items asynchronously
 * - Failed syncs can be retried automatically
 * - No timeout issues on long-running syncs
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);
const DR_PHOTO_API_URL = process.env.DR_PHOTO_API_URL || 'http://100.96.203.105:8003';

interface DrPhotoApiRecord {
  dr_number: string;
  ont_barcode: string | null;
  ups_serial: string | null;
}

interface ProcessResult {
  dropNumber: string;
  success: boolean;
  ontBarcode?: string | null;
  upsSerial?: string | null;
  error?: string;
}

/**
 * Fetch serial data from dr-photo-api
 */
async function fetchSerialDataFromApi(dropNumber: string): Promise<{
  success: boolean;
  data?: DrPhotoApiRecord;
  error?: string;
}> {
  try {
    const response = await fetch(`${DR_PHOTO_API_URL}/api/record/${dropNumber}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `API returned ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();
    return { success: true, data };
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
    const existing = await sql`
      SELECT id FROM onemap_properties WHERE drop_number = ${dropNumber} LIMIT 1
    `;

    if (existing.length === 0) {
      await sql`
        INSERT INTO onemap_properties (drop_number, ont_barcode, ups_serial, created_at, updated_at)
        VALUES (${dropNumber}, ${ontBarcode}, ${upsSerial}, NOW(), NOW())
      `;
    } else {
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
    log.error(`Error updating onemap_properties for ${dropNumber}`, { error });
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

  const { dropNumber, limit = 10 } = req.body;

  try {
    // Get pending items from queue
    const queueItems = dropNumber
      ? await sql`
          SELECT drop_number, attempts
          FROM onemap_sync_queue
          WHERE drop_number = ${dropNumber}
            AND status = 'pending'
          LIMIT 1
        `
      : await sql`
          SELECT drop_number, attempts
          FROM onemap_sync_queue
          WHERE status = 'pending'
            AND attempts < 3
          ORDER BY created_at ASC
          LIMIT ${limit}
        `;

    if (queueItems.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No pending items in queue',
        data: { processed: 0, succeeded: 0, failed: 0, results: [] },
      });
    }

    const results: ProcessResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const item of queueItems) {
      const { drop_number, attempts } = item;

      // Mark as processing
      await sql`
        UPDATE onemap_sync_queue
        SET status = 'processing',
            attempts = ${attempts + 1},
            updated_at = NOW()
        WHERE drop_number = ${drop_number}
      `;

      // Fetch serial data
      const apiResponse = await fetchSerialDataFromApi(drop_number);

      if (apiResponse.success && apiResponse.data) {
        const { ont_barcode, ups_serial } = apiResponse.data;
        const updated = await updateOnemapSerials(drop_number, ont_barcode, ups_serial);

        if (updated) {
          // Mark as completed
          await sql`
            UPDATE onemap_sync_queue
            SET status = 'completed',
                completed_at = NOW(),
                updated_at = NOW()
            WHERE drop_number = ${drop_number}
          `;

          results.push({
            dropNumber: drop_number,
            success: true,
            ontBarcode: ont_barcode,
            upsSerial: ups_serial,
          });
          succeeded++;
        } else {
          // Mark as failed
          await sql`
            UPDATE onemap_sync_queue
            SET status = 'failed',
                last_error = 'Failed to update onemap_properties',
                updated_at = NOW()
            WHERE drop_number = ${drop_number}
          `;

          results.push({
            dropNumber: drop_number,
            success: false,
            error: 'Failed to update onemap_properties',
          });
          failed++;
        }
      } else {
        // Mark as failed (will retry if attempts < 3)
        const status = attempts + 1 >= 3 ? 'failed' : 'pending';
        await sql`
          UPDATE onemap_sync_queue
          SET status = ${status},
              last_error = ${apiResponse.error || 'Unknown error'},
              updated_at = NOW()
          WHERE drop_number = ${drop_number}
        `;

        results.push({
          dropNumber: drop_number,
          success: false,
          error: apiResponse.error,
        });
        failed++;
      }

      // Small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return res.status(200).json({
      success: true,
      data: {
        processed: queueItems.length,
        succeeded,
        failed,
        results,
      },
    });
  } catch (error) {
    log.error('Error processing sync queue', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process sync queue',
    });
  }
}

export default withAuth(fetchSerialDataFromApi);
