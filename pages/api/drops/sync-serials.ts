/**
 * Serial Sync API Endpoint
 *
 * Syncs ONT and UPS serial numbers from 1Map API to drops table.
 *
 * GET: Returns drops missing serials (for preview)
 * POST: Syncs serials from 1Map API
 *
 * Query params:
 * - project: Project name filter (e.g., "Lawley", "Mohadin")
 * - limit: Max drops to process (default: 100)
 *
 * POST body:
 * - dropNumbers: Array of specific drops to sync (optional, syncs all if omitted)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

const ONEMAP_BASE_URL = 'http://100.96.203.105:8003/api/record';

interface OneMapResponse {
  dr_number: string;
  ont_barcode?: string;
  ups_serial?: string;
  status?: string;
  detail?: string;
}

interface SyncResult {
  drop_number: string;
  ont_serial: string | null;
  mini_ups_serial: string | null;
  status: 'updated' | 'no_data' | 'error' | 'skipped';
  message?: string;
}

async function fetch1MapData(drNumber: string): Promise<OneMapResponse | null> {
  try {
    const response = await fetch(`${ONEMAP_BASE_URL}/${drNumber}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    log.error(`1Map fetch error for ${drNumber}`, { error });
    return null;
  }
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { project, limit = '100' } = req.query;
  const projectName = project as string | undefined;
  const maxLimit = Math.min(parseInt(limit as string) || 100, 500);

  if (req.method === 'GET') {
    try {
      let rows;
      let countResult;

      if (projectName) {
        rows = await sql`
          SELECT d.drop_number, d.pole_number, d.ont_serial, d.mini_ups_serial, p.project_name
          FROM drops d
          LEFT JOIN projects p ON d.project_id = p.id
          WHERE (d.ont_serial IS NULL OR d.mini_ups_serial IS NULL)
            AND d.drop_number IS NOT NULL
            AND d.drop_number ~ '^DR[0-9]+$'
            AND LOWER(p.project_name) = LOWER(${projectName})
          ORDER BY d.drop_number
          LIMIT ${maxLimit}
        `;

        countResult = await sql`
          SELECT COUNT(*) as total
          FROM drops d
          LEFT JOIN projects p ON d.project_id = p.id
          WHERE (d.ont_serial IS NULL OR d.mini_ups_serial IS NULL)
            AND d.drop_number IS NOT NULL
            AND d.drop_number ~ '^DR[0-9]+$'
            AND LOWER(p.project_name) = LOWER(${projectName})
        `;
      } else {
        rows = await sql`
          SELECT drop_number, pole_number, ont_serial, mini_ups_serial
          FROM drops
          WHERE (ont_serial IS NULL OR mini_ups_serial IS NULL)
            AND drop_number IS NOT NULL
            AND drop_number ~ '^DR[0-9]+$'
          ORDER BY drop_number
          LIMIT ${maxLimit}
        `;

        countResult = await sql`
          SELECT COUNT(*) as total
          FROM drops
          WHERE (ont_serial IS NULL OR mini_ups_serial IS NULL)
            AND drop_number IS NOT NULL
            AND drop_number ~ '^DR[0-9]+$'
        `;
      }

      const total = parseInt(String(countResult[0]?.total || '0'));

      return res.status(200).json({
        success: true,
        total,
        count: rows.length,
        limit: maxLimit,
        drops: rows,
      });
    } catch (error) {
      log.error('Error fetching drops', { error });
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch drops',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const { dropNumbers } = req.body || {};

      let dropsToSync: { drop_number: string }[];

      if (dropNumbers && Array.isArray(dropNumbers) && dropNumbers.length > 0) {
        dropsToSync = dropNumbers.map((dn: string) => ({ drop_number: dn }));
      } else {
        if (projectName) {
          dropsToSync = (await sql`
            SELECT d.drop_number
            FROM drops d
            LEFT JOIN projects p ON d.project_id = p.id
            WHERE (d.ont_serial IS NULL OR d.mini_ups_serial IS NULL)
              AND d.drop_number IS NOT NULL
              AND d.drop_number ~ '^DR[0-9]+$'
              AND LOWER(p.project_name) = LOWER(${projectName})
            ORDER BY d.drop_number
            LIMIT ${maxLimit}
          `) as { drop_number: string }[];
        } else {
          dropsToSync = (await sql`
            SELECT drop_number
            FROM drops
            WHERE (ont_serial IS NULL OR mini_ups_serial IS NULL)
              AND drop_number IS NOT NULL
              AND drop_number ~ '^DR[0-9]+$'
            ORDER BY drop_number
            LIMIT ${maxLimit}
          `) as { drop_number: string }[];
        }
      }

      if (dropsToSync.length === 0) {
        return res.status(200).json({
          success: true,
          message: 'No drops to sync',
          results: [],
        });
      }

      const results: SyncResult[] = [];
      let updated = 0;
      let noData = 0;
      let errors = 0;

      for (const drop of dropsToSync) {
        const drNumber = drop.drop_number;
        const oneMapData = await fetch1MapData(drNumber);

        if (!oneMapData) {
          results.push({
            drop_number: drNumber,
            ont_serial: null,
            mini_ups_serial: null,
            status: 'no_data',
            message: 'Not found in 1Map',
          });
          noData++;
          continue;
        }

        if (oneMapData.detail) {
          results.push({
            drop_number: drNumber,
            ont_serial: null,
            mini_ups_serial: null,
            status: 'no_data',
            message: oneMapData.detail,
          });
          noData++;
          continue;
        }

        const ontSerial = oneMapData.ont_barcode || null;
        const upsSerial = oneMapData.ups_serial || null;

        if (!ontSerial && !upsSerial) {
          results.push({
            drop_number: drNumber,
            ont_serial: null,
            mini_ups_serial: null,
            status: 'no_data',
            message: 'No serial data in 1Map',
          });
          noData++;
          continue;
        }

        try {
          await sql`
            UPDATE drops
            SET
              ont_serial = COALESCE(${ontSerial}, ont_serial),
              mini_ups_serial = COALESCE(${upsSerial}, mini_ups_serial),
              updated_at = NOW()
            WHERE drop_number = ${drNumber}
          `;

          results.push({
            drop_number: drNumber,
            ont_serial: ontSerial,
            mini_ups_serial: upsSerial,
            status: 'updated',
          });
          updated++;
        } catch (updateError) {
          results.push({
            drop_number: drNumber,
            ont_serial: ontSerial,
            mini_ups_serial: upsSerial,
            status: 'error',
            message:
              updateError instanceof Error
                ? updateError.message
                : 'Update failed',
          });
          errors++;
        }

        // Small delay to avoid overwhelming 1Map API
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      return res.status(200).json({
        success: true,
        summary: {
          total: dropsToSync.length,
          updated,
          noData,
          errors,
        },
        results,
      });
    } catch (error) {
      log.error('Error syncing serials', { error });
      return res.status(500).json({
        success: false,
        error: 'Failed to sync serials',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(fetch1MapData);
