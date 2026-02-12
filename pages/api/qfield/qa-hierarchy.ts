/**
 * GET /api/qfield/qa-hierarchy
 * Returns project -> zone -> PON -> feature type hierarchy with photo counts
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface HierarchyRow {
  zone_no: number | null;
  pon_no: number | null;
  work_type: string | null;
  photo_count: string;
  pending: string;
  approved: string;
  rejected: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  try {
    const { projectId } = req.query;

    if (!projectId || typeof projectId !== 'string') {
      return apiResponse.badRequest(res, 'projectId is required');
    }

    // Get hierarchy grouped by zone, PON, and work type
    // Join to drops for zone_no/pon_no (drops table has the zone/PON data, poles table doesn't)
    // Use a subquery to get one zone/pon per pole_number to avoid inflated counts from multiple drops
    const rows: HierarchyRow[] = await sql`
      SELECT
        dz.zone_no,
        dz.pon_no,
        v.work_type,
        COUNT(*)::int as photo_count,
        COUNT(*) FILTER (WHERE v.workflow_status = 'pending')::int as pending,
        COUNT(*) FILTER (WHERE v.workflow_status = 'approved')::int as approved,
        COUNT(*) FILTER (WHERE v.workflow_status = 'rejected')::int as rejected
      FROM qfield_photo_validations v
      LEFT JOIN (
        SELECT DISTINCT ON (pole_number) pole_number, zone_no, pon_no
        FROM drops
        ORDER BY pole_number, zone_no, pon_no
      ) dz ON v.feature_id = dz.pole_number
      WHERE v.project_id = (
        SELECT id FROM qfield_projects WHERE id = ${projectId}::uuid
      )
      GROUP BY dz.zone_no, dz.pon_no, v.work_type
      ORDER BY dz.zone_no NULLS LAST, dz.pon_no NULLS LAST, v.work_type
    `;

    // Build the hierarchical structure
    const zoneMap = new Map<number | null, {
      zone_no: number | null;
      photo_count: number;
      pending: number;
      approved: number;
      rejected: number;
      ponMap: Map<number | null, {
        pon_no: number | null;
        photo_count: number;
        pending: number;
        approved: number;
        rejected: number;
        feature_types: Array<{
          work_type: string;
          photo_count: number;
          pending: number;
          approved: number;
          rejected: number;
        }>;
      }>;
    }>();

    let totalPhotos = 0;
    let totalPending = 0;
    let totalApproved = 0;
    let totalRejected = 0;

    for (const row of rows) {
      const photoCount = Number(row.photo_count);
      const pending = Number(row.pending);
      const approved = Number(row.approved);
      const rejected = Number(row.rejected);

      totalPhotos += photoCount;
      totalPending += pending;
      totalApproved += approved;
      totalRejected += rejected;

      // Get or create zone
      if (!zoneMap.has(row.zone_no)) {
        zoneMap.set(row.zone_no, {
          zone_no: row.zone_no,
          photo_count: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
          ponMap: new Map(),
        });
      }
      const zone = zoneMap.get(row.zone_no)!;
      zone.photo_count += photoCount;
      zone.pending += pending;
      zone.approved += approved;
      zone.rejected += rejected;

      // Get or create PON within zone
      if (!zone.ponMap.has(row.pon_no)) {
        zone.ponMap.set(row.pon_no, {
          pon_no: row.pon_no,
          photo_count: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
          feature_types: [],
        });
      }
      const pon = zone.ponMap.get(row.pon_no)!;
      pon.photo_count += photoCount;
      pon.pending += pending;
      pon.approved += approved;
      pon.rejected += rejected;

      // Add feature type
      pon.feature_types.push({
        work_type: row.work_type || 'unknown',
        photo_count: photoCount,
        pending,
        approved,
        rejected,
      });
    }

    // Convert maps to arrays
    const zones = Array.from(zoneMap.values()).map(zone => ({
      zone_no: zone.zone_no,
      photo_count: zone.photo_count,
      pending: zone.pending,
      approved: zone.approved,
      rejected: zone.rejected,
      pons: Array.from(zone.ponMap.values()).map(pon => ({
        pon_no: pon.pon_no,
        photo_count: pon.photo_count,
        pending: pon.pending,
        approved: pon.approved,
        rejected: pon.rejected,
        feature_types: pon.feature_types,
      })),
    }));

    return apiResponse.success(res, {
      zones,
      totals: {
        photo_count: totalPhotos,
        pending: totalPending,
        approved: totalApproved,
        rejected: totalRejected,
      },
    });
  } catch (error) {
    log.error('qfield-qa-hierarchy', error instanceof Error ? { message: error.message } : { error }, 'Fetch failed');
    return apiResponse.databaseError(res, error);
  }
}

export default withAuth(handler);
