/**
 * Staff Compliance Status API
 * GET /api/staff/[staffId]/compliance - Get compliance document status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffComplianceAPI');

// Required documents for full compliance
const REQUIRED_DOCUMENTS = [
  { type: 'id_document', label: 'ID Document / Passport', required: true },
  { type: 'employment_contract', label: 'Employment Contract', required: true },
  { type: 'bank_details', label: 'Bank Confirmation Letter', required: true },
  { type: 'tax_document', label: 'Tax Document (IRP5/IT3a)', required: false },
  { type: 'police_clearance', label: 'Police Clearance', required: false },
  { type: 'drivers_license', label: "Driver's License", required: false },
  { type: 'medical_certificate', label: 'Medical Certificate', required: false },
] as const;

interface DocumentStatus {
  type: string;
  label: string;
  required: boolean;
  uploaded: boolean;
  verified: boolean;
  pending: boolean;
  rejected: boolean;
  expired: boolean;
  documentId?: string;
  documentNumber?: string;
  expiryDate?: string;
  verifiedAt?: string;
}

interface ComplianceStatus {
  isCompliant: boolean;
  requiredComplete: number;
  requiredTotal: number;
  optionalComplete: number;
  optionalTotal: number;
  documents: DocumentStatus[];
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { staffId } = req.query;

  if (!staffId || typeof staffId !== 'string') {
    return res.status(400).json({ error: 'Staff ID is required' });
  }

  if (req.method === 'GET') {
    try {
      // Fetch all documents for this staff member
      const documents = await sql`
        SELECT
          id,
          document_type,
          document_number,
          verification_status,
          verified_at,
          expiry_date
        FROM staff_documents
        WHERE staff_id = ${staffId}
        ORDER BY created_at DESC
      `;

      // Group documents by type and get the best status for each
      const documentsByType = new Map<string, typeof documents[0]>();

      for (const doc of documents) {
        const type = doc.document_type as string;
        const existing = documentsByType.get(type);

        // Prefer verified documents, then pending, then most recent
        if (!existing ||
            (doc.verification_status === 'verified' && existing.verification_status !== 'verified') ||
            (doc.verification_status === 'pending' && existing.verification_status === 'rejected')) {
          documentsByType.set(type, doc);
        }
      }

      // Build compliance status for each required document type
      const documentStatuses: DocumentStatus[] = REQUIRED_DOCUMENTS.map(reqDoc => {
        const doc = documentsByType.get(reqDoc.type);
        const now = new Date();

        if (!doc) {
          return {
            type: reqDoc.type,
            label: reqDoc.label,
            required: reqDoc.required,
            uploaded: false,
            verified: false,
            pending: false,
            rejected: false,
            expired: false,
          };
        }

        const expiryDate = doc.expiry_date ? new Date(doc.expiry_date as string) : null;
        const isExpired = expiryDate ? expiryDate < now : false;

        return {
          type: reqDoc.type,
          label: reqDoc.label,
          required: reqDoc.required,
          uploaded: true,
          verified: doc.verification_status === 'verified' && !isExpired,
          pending: doc.verification_status === 'pending',
          rejected: doc.verification_status === 'rejected',
          expired: isExpired,
          documentId: doc.id as string,
          documentNumber: doc.document_number as string | undefined,
          expiryDate: expiryDate?.toISOString(),
          verifiedAt: doc.verified_at ? new Date(doc.verified_at as string).toISOString() : undefined,
        };
      });

      // Calculate compliance summary
      const requiredDocs = documentStatuses.filter(d => d.required);
      const optionalDocs = documentStatuses.filter(d => !d.required);

      const requiredComplete = requiredDocs.filter(d => d.verified).length;
      const requiredTotal = requiredDocs.length;
      const optionalComplete = optionalDocs.filter(d => d.verified).length;
      const optionalTotal = optionalDocs.length;

      // Full compliance requires all required documents to be verified
      const isCompliant = requiredComplete === requiredTotal;

      const complianceStatus: ComplianceStatus = {
        isCompliant,
        requiredComplete,
        requiredTotal,
        optionalComplete,
        optionalTotal,
        documents: documentStatuses,
      };

      return res.status(200).json(complianceStatus);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to fetch compliance status', { staffId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to fetch compliance status', message: errorMessage });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withArcjetProtection(handler, aj);
