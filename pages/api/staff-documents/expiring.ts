/**
 * Expiring Documents API
 * GET /api/staff-documents/expiring
 * Get documents expiring within N days
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import {
  canAccessStaffDocuments,
  canAccessSensitiveStaffData,
  canAccessTrainingCertificates,
} from '@/services/staff/staffAccessService';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';


const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('ExpiringDocumentsAPI');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // withAuth has already attached `user`; AuthenticatedHandler is typed against
  // the base request, so narrow here (same idiom as ./[documentId]/verify.ts).
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const { days = '30', staffId } = req.query;

    const daysNum = parseInt(days as string, 10);
    if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
      return res.status(400).json({
        error: 'Invalid days parameter. Must be between 1 and 365',
      });
    }

    // Scope, decided server-side. A per-staff request is authorized against that
    // employee; the all-staff request needs the HR-sensitive grant, because it
    // is a cross-employee read.
    const userId = authReq.user.id;
    const canAccessAll =
      staffId && typeof staffId === 'string'
        ? await canAccessStaffDocuments(userId, staffId)
        : await canAccessSensitiveStaffData(userId);
    const certificatesOnly = !canAccessAll && (await canAccessTrainingCertificates(userId));
    if (!canAccessAll && !certificatesOnly) {
      return apiResponse.forbidden(res, 'You do not have permission to view these documents');
    }

    // `certificatesOnly` is bound as a parameter rather than spliced in as a
    // SQL fragment: the Neon shim parameterises every interpolation, so a
    // conditional fragment would be sent as a literal string. One static query
    // shape, scoped by a bound boolean.
    //
    // The projection is column-by-column and omits file_path and file_url.
    let documents;

    if (staffId && typeof staffId === 'string') {
      documents = await sql`
        SELECT
            sd.id, sd.staff_id, sd.document_type, sd.document_name,
            sd.file_size, sd.mime_type, sd.expiry_date, sd.issued_date,
            sd.issuing_authority, sd.document_number, sd.verification_status,
            sd.verified_by, sd.verified_at, sd.verification_notes,
            sd.created_at, sd.updated_at,
            s.name as staff_name,
            s.email as staff_email
        FROM staff_documents sd
        LEFT JOIN staff s ON s.id = sd.staff_id
        WHERE sd.staff_id = ${staffId}
          AND sd.expiry_date IS NOT NULL
          AND sd.expiry_date <= CURRENT_DATE + INTERVAL '1 day' * ${daysNum}
          AND sd.expiry_date >= CURRENT_DATE
          AND sd.verification_status != 'expired'
          AND (${certificatesOnly}::boolean = false OR sd.document_type = 'certification')
        ORDER BY sd.expiry_date ASC
      `;
    } else {
      documents = await sql`
        SELECT
            sd.id, sd.staff_id, sd.document_type, sd.document_name,
            sd.file_size, sd.mime_type, sd.expiry_date, sd.issued_date,
            sd.issuing_authority, sd.document_number, sd.verification_status,
            sd.verified_by, sd.verified_at, sd.verification_notes,
            sd.created_at, sd.updated_at,
            s.name as staff_name,
            s.email as staff_email
        FROM staff_documents sd
        LEFT JOIN staff s ON s.id = sd.staff_id
        WHERE sd.expiry_date IS NOT NULL
          AND sd.expiry_date <= CURRENT_DATE + INTERVAL '1 day' * ${daysNum}
          AND sd.expiry_date >= CURRENT_DATE
          AND sd.verification_status != 'expired'
          AND (${certificatesOnly}::boolean = false OR sd.document_type = 'certification')
        ORDER BY sd.expiry_date ASC
      `;
    }

    let expiredDocuments;
    if (staffId && typeof staffId === 'string') {
      expiredDocuments = await sql`
        SELECT
            sd.id, sd.staff_id, sd.document_type, sd.document_name,
            sd.file_size, sd.mime_type, sd.expiry_date, sd.issued_date,
            sd.issuing_authority, sd.document_number, sd.verification_status,
            sd.verified_by, sd.verified_at, sd.verification_notes,
            sd.created_at, sd.updated_at,
            s.name as staff_name,
            s.email as staff_email
        FROM staff_documents sd
        LEFT JOIN staff s ON s.id = sd.staff_id
        WHERE sd.staff_id = ${staffId}
          AND sd.expiry_date IS NOT NULL
          AND sd.expiry_date < CURRENT_DATE
          AND (${certificatesOnly}::boolean = false OR sd.document_type = 'certification')
        ORDER BY sd.expiry_date DESC
      `;
    } else {
      expiredDocuments = await sql`
        SELECT
            sd.id, sd.staff_id, sd.document_type, sd.document_name,
            sd.file_size, sd.mime_type, sd.expiry_date, sd.issued_date,
            sd.issuing_authority, sd.document_number, sd.verification_status,
            sd.verified_by, sd.verified_at, sd.verification_notes,
            sd.created_at, sd.updated_at,
            s.name as staff_name,
            s.email as staff_email
        FROM staff_documents sd
        LEFT JOIN staff s ON s.id = sd.staff_id
        WHERE sd.expiry_date IS NOT NULL
          AND sd.expiry_date < CURRENT_DATE
          AND (${certificatesOnly}::boolean = false OR sd.document_type = 'certification')
        ORDER BY sd.expiry_date DESC
      `;
    }

    // Calculate days until expiry for each document
    const now = new Date();
    const enrichedDocuments = documents.map((doc: Record<string, unknown>) => {
      const expiryDate = new Date(doc.expiry_date as string);
      const diffTime = expiryDate.getTime() - now.getTime();
      const daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      return {
        ...mapDbToDocument(doc),
        daysUntilExpiry,
        urgency: daysUntilExpiry <= 7 ? 'critical' : daysUntilExpiry <= 30 ? 'warning' : 'info',
      };
    });

    const enrichedExpired = expiredDocuments.map((doc: Record<string, unknown>) => {
      const expiryDate = new Date(doc.expiry_date as string);
      const diffTime = now.getTime() - expiryDate.getTime();
      const daysExpired = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      return {
        ...mapDbToDocument(doc),
        daysExpired,
        urgency: 'expired',
      };
    });

    return res.status(200).json({
      success: true,
      expiring: enrichedDocuments,
      expired: enrichedExpired,
      summary: {
        expiringCount: enrichedDocuments.length,
        expiredCount: enrichedExpired.length,
        criticalCount: enrichedDocuments.filter((d: { urgency: string }) => d.urgency === 'critical').length,
        warningCount: enrichedDocuments.filter((d: { urgency: string }) => d.urgency === 'warning').length,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to fetch expiring documents', { error: errorMessage });
    return res.status(500).json({ error: 'Failed to fetch expiring documents', message: errorMessage });
  }
}

export default withAuth(withArcjetProtection(handler, aj));

// Map database row to StaffDocument interface
function mapDbToDocument(row: Record<string, unknown>) {
  return {
    id: row.id,
    staffId: row.staff_id,
    documentType: row.document_type,
    documentName: row.document_name,
    // The protected route, never the storage location.
    downloadUrl: `/api/staff-documents-download?documentId=${row.id as string}`,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    expiryDate: row.expiry_date ? new Date(row.expiry_date as string).toISOString() : undefined,
    issuedDate: row.issued_date ? new Date(row.issued_date as string).toISOString() : undefined,
    issuingAuthority: row.issuing_authority,
    documentNumber: row.document_number,
    verificationStatus: row.verification_status,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at ? new Date(row.verified_at as string).toISOString() : undefined,
    verificationNotes: row.verification_notes,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    staff: row.staff_name
      ? {
          id: row.staff_id,
          name: row.staff_name,
          email: row.staff_email,
        }
      : undefined,
  };
}
