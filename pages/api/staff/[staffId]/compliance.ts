/**
 * Staff Compliance Status API
 * GET /api/staff/[staffId]/compliance - Get compliance document status
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { SA_CONTRACT_CONFIG, SAContractType, mapLegacyContractType } from '@/types/staff/compliance.types';
import { canAccessStaffDocuments } from '@/services/staff/staffAccessService';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffComplianceAPI');

// Get required documents based on contract type
function getRequiredDocuments(contractType: SAContractType | null) {
  const config = contractType ? SA_CONTRACT_CONFIG[contractType] : null;
  const isEmployee = config?.isEmployee ?? true; // Default to employee if unknown

  return [
    { type: 'id_document', alternativeTypes: ['sa_id', 'passport'], label: 'ID Document / Passport', required: true },
    {
      type: 'employment_contract',
      alternativeTypes: [],
      label: isEmployee ? 'Employment Contract' : 'IC Agreement',
      required: true
    },
    { type: 'bank_details', alternativeTypes: ['bank_statement'], label: 'Bank Confirmation Letter', required: true },
    {
      type: 'tax_document',
      alternativeTypes: [],
      label: isEmployee ? 'Tax Document (IRP5)' : 'Tax Document (IT3a)',
      required: false
    },
    { type: 'police_clearance', alternativeTypes: [], label: 'Police Clearance', required: false },
    { type: 'drivers_license', alternativeTypes: [], label: "Driver's License", required: false },
    { type: 'medical_certificate', alternativeTypes: [], label: 'Medical Certificate', required: false },
  ];
}

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
  contractType: SAContractType | null;
  isEmployee: boolean;
}

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { staffId } = req.query;
  const userId = req.user.id;

  if (!staffId || typeof staffId !== 'string') {
    return apiResponse.badRequest(res, 'Staff ID is required');
  }

  if (req.method === 'GET') {
    try {
      // Check if user can access compliance data for this staff member
      // Compliance contains bank, tax, UIF info - requires sensitive access or self-view
      const canAccess = await canAccessStaffDocuments(userId, staffId);
      if (!canAccess) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to view compliance data for this staff member'
        });
      }
      // Fetch staff member's contract type
      const staffResult = await sql`
        SELECT contract_type FROM staff WHERE id = ${staffId}
      `;
      const staffContractType = staffResult[0]?.contract_type as string | null;
      const contractType = staffContractType ? mapLegacyContractType(staffContractType) : null;

      // Get required documents based on contract type
      const requiredDocuments = getRequiredDocuments(contractType);

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
      const documentStatuses: DocumentStatus[] = requiredDocuments.map(reqDoc => {
        // Check primary type first, then alternatives
        let doc = documentsByType.get(reqDoc.type);
        if (!doc && reqDoc.alternativeTypes.length > 0) {
          for (const altType of reqDoc.alternativeTypes) {
            doc = documentsByType.get(altType);
            if (doc) break;
          }
        }

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

      const config = contractType ? SA_CONTRACT_CONFIG[contractType] : null;
      const complianceStatus: ComplianceStatus = {
        isCompliant,
        requiredComplete,
        requiredTotal,
        optionalComplete,
        optionalTotal,
        documents: documentStatuses,
        contractType,
        isEmployee: config?.isEmployee ?? true,
      };

      return res.status(200).json(complianceStatus);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to fetch compliance status', { staffId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to fetch compliance status', message: errorMessage });
    }
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
}

export default withAuth(withArcjetProtection(handler as any, aj));
