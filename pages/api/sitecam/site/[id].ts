/**
 * GET /api/sitecam/site/:id
 *
 * Look up a DR number or pole number and return display info for the PWA.
 * DR format: DR-XXXXXX or numeric only.
 * Pole format: anything else (checked against the poles table).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

/**
 * Candidate drop_number values to match a normalized DR input against.
 * `drops.drop_number` is stored DR-prefixed for ~99.8% of rows (e.g. "DR1854086")
 * but bare-numeric for a few (e.g. "50"), so match both the prefixed and the
 * bare digits rather than assuming one format.
 */
export function dropNumberCandidates(normalized: string): string[] {
  const digits = normalized.replace(/^DR-?/, '');
  return [`DR${digits}`, digits];
}

/**
 * Canonical DR site id: always DR-prefixed. A few drops rows are stored
 * bare-numeric ("50"), but the downstream submission table
 * (dr_photo_unified_reviews) is 100% DR-prefixed, so the id sent to
 * validate/upload must be prefixed for the submission record to match.
 */
export function toDrSiteId(dropNumber: string): string {
  return /^\d+$/.test(dropNumber) ? `DR${dropNumber}` : dropNumber;
}

/** Coerce a possibly-string/null numeric DB value to number|null (NaN → null). */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface SiteGeo {
  plannedLat: number | null;
  plannedLon: number | null;
  pon: number | null;
  zone: number | null;
}

/** Map a drops/poles row's geo columns into the SiteInfo geo fields. */
export function toSiteGeo(row: {
  latitude?: unknown;
  longitude?: unknown;
  pon_no?: unknown;
  zone_no?: unknown;
}): SiteGeo {
  return {
    plannedLat: num(row.latitude),
    plannedLon: num(row.longitude),
    pon: num(row.pon_no),
    zone: num(row.zone_no),
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);

  const { id } = req.query;
  if (!id || typeof id !== 'string') return apiResponse.badRequest(res, 'Site ID required');

  const normalized = id.trim().toUpperCase();

  // DR lookup — accepts "DR-123456", "DR123456" or bare "123456"
  if (/^(DR-?)?\d+$/.test(normalized)) {
    const { rows } = await pool.query<{
      drop_number: string;
      customer_name: string | null;
      address: string | null;
      project_name: string | null;
      latitude: string | null;
      longitude: string | null;
      pon_no: number | null;
      zone_no: number | null;
    }>(
      `SELECT d.drop_number,
              d.customer_name,
              d.address,
              d.latitude,
              d.longitude,
              d.pon_no,
              d.zone_no,
              p.project_name
       FROM drops d
       LEFT JOIN projects p ON p.id = d.project_id
       WHERE d.drop_number = ANY($1)
       LIMIT 1`,
      [dropNumberCandidates(normalized)]
    );
    if (!rows[0]) return apiResponse.notFound(res, 'DR', normalized);
    const r = rows[0];
    return apiResponse.success(res, {
      jobType: 'activations',
      // Canonical DR-prefixed id so it round-trips through the wizard /
      // validate / upload (which match the DR-prefixed dr_photo_unified_reviews).
      siteId: toDrSiteId(r.drop_number),
      customerName: r.customer_name ?? null,
      address: r.address ?? null,
      projectName: r.project_name ?? null,
      ...toSiteGeo(r),
    });
  }

  // Pole lookup
  const { rows } = await pool.query<{
    pole_number: string;
    project_name: string | null;
    latitude: string | null;
    longitude: string | null;
    pon_no: number | null;
    zone_no: number | null;
  }>(
    `SELECT po.pole_number,
            po.latitude,
            po.longitude,
            po.pon_no,
            po.zone_no,
            p.project_name
     FROM poles po
     LEFT JOIN projects p ON p.id = po.project_id
     WHERE po.pole_number = $1
     LIMIT 1`,
    [normalized]
  );
  if (!rows[0]) return apiResponse.notFound(res, 'Pole', normalized);
  const r = rows[0];
  return apiResponse.success(res, {
    jobType: 'civils',
    siteId: r.pole_number,
    customerName: null,
    address: null,
    projectName: r.project_name ?? null,
    ...toSiteGeo(r),
  });
}

export default withAuth(handler);
