/**
 * Fleet Drivers Documents API
 * GET /api/fleet/drivers-documents - Get all drivers with their license document status
 *
 * Used by Fleet Drivers Documents tab to show license status and allow upload/verify.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

interface DriverDocument {
  staffId: string;
  staffName: string;
  department: string | null;
  photoUrl: string | null;
  documentId: string | null;
  documentStatus: 'verified' | 'pending' | 'rejected' | 'missing' | null;
  licenseExpiry: string | null;
  licenseStatus: 'valid' | 'expiring' | 'expired' | 'missing';
  uploadedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET']);
  }

  try {
    // Get all active staff with their latest driver's license document status
    const rows = await sql`
      WITH latest_license AS (
        SELECT DISTINCT ON (staff_id)
          id as document_id,
          staff_id,
          verification_status,
          expiry_date,
          created_at as uploaded_at,
          verified_at,
          verified_by
        FROM staff_documents
        WHERE document_type = 'drivers_license'
        ORDER BY staff_id, created_at DESC
      )
      SELECT
        s.id as staff_id,
        CONCAT(s.first_name, ' ', s.last_name) as staff_name,
        s.department,
        s.photo_url,
        ll.document_id,
        ll.verification_status as document_status,
        ll.expiry_date as license_expiry,
        ll.uploaded_at,
        ll.verified_at,
        ll.verified_by,
        -- Calculate license status
        CASE
          WHEN ll.document_id IS NULL THEN 'missing'
          WHEN ll.verification_status != 'verified' THEN 'missing'
          WHEN ll.expiry_date IS NULL THEN 'valid'
          WHEN ll.expiry_date < CURRENT_DATE THEN 'expired'
          WHEN ll.expiry_date < CURRENT_DATE + INTERVAL '30 days' THEN 'expiring'
          ELSE 'valid'
        END as license_status
      FROM staff s
      LEFT JOIN latest_license ll ON ll.staff_id = s.id
      WHERE UPPER(s.status) = 'ACTIVE'
      ORDER BY
        CASE
          WHEN ll.verification_status = 'pending' THEN 0
          WHEN ll.expiry_date IS NULL AND ll.document_id IS NULL THEN 1
          WHEN ll.expiry_date < CURRENT_DATE THEN 2
          WHEN ll.expiry_date < CURRENT_DATE + INTERVAL '30 days' THEN 3
          ELSE 4
        END,
        s.first_name,
        s.last_name
    `;

    const drivers: DriverDocument[] = rows.map((row) => {
      let licenseExpiry: string | null = null;
      let uploadedAt: string | null = null;
      let verifiedAt: string | null = null;

      if (row.license_expiry) {
        // ISO string is always YYYY-MM-DDTHH:MM:SS.sssZ format
        licenseExpiry = new Date(row.license_expiry as string).toISOString().substring(0, 10);
      }
      if (row.uploaded_at) {
        uploadedAt = new Date(row.uploaded_at as string).toISOString();
      }
      if (row.verified_at) {
        verifiedAt = new Date(row.verified_at as string).toISOString();
      }

      return {
        staffId: row.staff_id as string,
        staffName: row.staff_name as string,
        department: row.department as string | null,
        photoUrl: row.photo_url as string | null,
        documentId: row.document_id as string | null,
        documentStatus: row.document_status as DriverDocument['documentStatus'],
        licenseExpiry,
        licenseStatus: row.license_status as DriverDocument['licenseStatus'],
        uploadedAt,
        verifiedAt,
        verifiedBy: row.verified_by as string | null,
      };
    });

    // Calculate summary stats
    const summary = {
      total: drivers.length,
      valid: drivers.filter((d) => d.licenseStatus === 'valid').length,
      expiring: drivers.filter((d) => d.licenseStatus === 'expiring').length,
      expired: drivers.filter((d) => d.licenseStatus === 'expired').length,
      missing: drivers.filter((d) => d.licenseStatus === 'missing').length,
      pendingVerification: drivers.filter((d) => d.documentStatus === 'pending').length,
    };

    return apiResponse.success(res, {
      drivers,
      summary,
    });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
