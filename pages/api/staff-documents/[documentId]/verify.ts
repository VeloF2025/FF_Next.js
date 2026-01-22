/**
 * Staff Document Verification API
 * POST /api/staff-documents/[documentId]/verify
 * Verify or reject a staff document
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { getAuth } from '@/lib/auth-mock';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';
import { recordOcrCorrections } from '@/modules/qa-learning';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffDocumentVerifyAPI');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { documentId } = req.query;

  if (!documentId || typeof documentId !== 'string') {
    return res.status(400).json({ error: 'Document ID is required' });
  }

  try {
    const { status, notes, ocrMetadata: editedOcrMetadata } = req.body;

    // Validate status
    if (!status || !['verified', 'rejected'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status. Must be "verified" or "rejected"',
      });
    }

    // Get original document to compare OCR values for HITL learning
    const [originalDoc] = await sql`
      SELECT document_type, ocr_metadata, staff_id FROM staff_documents WHERE id = ${documentId}
    `;

    if (!originalDoc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentType = originalDoc.document_type as string;
    const originalOcrMetadata = (originalDoc.ocr_metadata || {}) as Record<string, string>;

    // Get the current user for verifier ID from Clerk (needed for HITL recording)
    const { userId } = getAuth(req);

    // If edited OCR metadata provided, update the document first
    if (editedOcrMetadata && Object.keys(editedOcrMetadata).length > 0) {
      await sql`
        UPDATE staff_documents
        SET ocr_metadata = ${JSON.stringify(editedOcrMetadata)}::jsonb,
            updated_at = NOW()
        WHERE id = ${documentId}
      `;
      logger.info('Updated OCR metadata before verification', { documentId, fields: Object.keys(editedOcrMetadata) });

      // Record HITL corrections for any fields that were changed
      // This helps improve future VLM OCR extractions
      if (status === 'verified') {
        await recordOcrCorrectionsFromVerification(
          documentType,
          originalOcrMetadata,
          editedOcrMetadata,
          documentId,
          userId || 'unknown'
        );
      }
    }

    // Find staff member by user_id if available
    // Note: userId might be a demo/mock value, so we handle gracefully
    let verifierId: string | null = null;
    if (userId) {
      try {
        const [staffMember] = await sql`
          SELECT id FROM staff WHERE user_id = ${userId}
        `;
        if (staffMember) {
          verifierId = staffMember.id as string;
        }
      } catch {
        // User ID not found or invalid format - continue without verifier
        logger.warn('Could not find staff member for user', { userId });
      }
    }

    // Update document verification status
    const [updated] = await sql`
      UPDATE staff_documents
      SET
        verification_status = ${status},
        verified_by = ${verifierId},
        verified_at = NOW(),
        verification_notes = ${notes || null},
        updated_at = NOW()
      WHERE id = ${documentId}
      RETURNING *
    `;

    if (!updated) {
      return res.status(404).json({ error: 'Document not found' });
    }

    logger.info('Document verification updated', { documentId, status, verifierId });

    // If document is verified, sync OCR metadata to staff table
    if (status === 'verified') {
      await syncOcrMetadataToStaff(updated as Record<string, unknown>);
    }

    // Get full document with joins
    const [document] = await sql`
      SELECT
        sd.*,
        CONCAT(s.first_name, ' ', s.last_name) as staff_name,
        CONCAT(v.first_name, ' ', v.last_name) as verifier_name
      FROM staff_documents sd
      LEFT JOIN staff s ON s.id = sd.staff_id
      LEFT JOIN staff v ON v.id = sd.verified_by
      WHERE sd.id = ${documentId}
    `;

    if (!document) {
      return res.status(404).json({ error: 'Document not found after verification' });
    }

    return res.status(200).json({
      success: true,
      document: mapDbToDocument(document as Record<string, unknown>),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to verify document', { documentId, error: errorMessage });
    return res.status(500).json({ error: 'Failed to verify document', message: errorMessage });
  }
}

export default withArcjetProtection(handler, aj);

// Map database row to StaffDocument interface
function mapDbToDocument(row: Record<string, unknown>) {
  return {
    id: row.id,
    staffId: row.staff_id,
    documentType: row.document_type,
    documentName: row.document_name,
    fileUrl: row.file_url,
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
    ocrMetadata: row.ocr_metadata || undefined,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    staff: row.staff_name ? { id: row.staff_id, name: row.staff_name } : undefined,
    verifier: row.verifier_name ? { id: row.verified_by, name: row.verifier_name } : undefined,
  };
}

/**
 * Sync OCR metadata to staff table when document is verified
 * This is called after successful verification to populate staff fields
 * Compulsory docs: SA ID, Passport, Driver's License, Bank Details
 */
async function syncOcrMetadataToStaff(document: Record<string, unknown>): Promise<void> {
  const staffId = document.staff_id as string;
  const documentType = document.document_type as string;
  const ocrMetadata = document.ocr_metadata as Record<string, string> | null;

  if (!staffId || !ocrMetadata || Object.keys(ocrMetadata).length === 0) {
    return;
  }

  try {
    switch (documentType) {
      case 'sa_id':
        // Sync SA ID number to staff table
        const { saIdNumber } = ocrMetadata;
        if (saIdNumber) {
          await sql`
            UPDATE staff
            SET
              sa_id_number = ${saIdNumber},
              updated_at = NOW()
            WHERE id = ${staffId}
          `;
          logger.info('Synced SA ID from verified document', { staffId, saIdNumber });
        }
        break;

      case 'passport':
        // Sync passport details to staff table
        const { passportNumber, passportExpiry, passportCountry } = ocrMetadata;
        if (passportNumber || passportExpiry || passportCountry) {
          await sql`
            UPDATE staff
            SET
              passport_number = COALESCE(${passportNumber || null}, passport_number),
              passport_expiry = COALESCE(${passportExpiry ? new Date(passportExpiry) : null}, passport_expiry),
              passport_country = COALESCE(${passportCountry || null}, passport_country),
              updated_at = NOW()
            WHERE id = ${staffId}
          `;
          logger.info('Synced passport from verified document', { staffId, passportNumber });
        }
        break;

      case 'drivers_license':
        // Sync driver's license details to staff table
        const { driversLicenseNumber, driversLicenseExpiry, driversLicenseCodes } = ocrMetadata;
        if (driversLicenseNumber || driversLicenseExpiry || driversLicenseCodes) {
          await sql`
            UPDATE staff
            SET
              drivers_license_number = COALESCE(${driversLicenseNumber || null}, drivers_license_number),
              drivers_license_expiry = COALESCE(${driversLicenseExpiry ? new Date(driversLicenseExpiry) : null}, drivers_license_expiry),
              drivers_license_codes = COALESCE(${driversLicenseCodes || null}, drivers_license_codes),
              updated_at = NOW()
            WHERE id = ${staffId}
          `;
          logger.info('Synced drivers license from verified document', {
            staffId,
            licenseNumber: driversLicenseNumber,
            licenseCodes: driversLicenseCodes,
          });
        }
        break;

      case 'bank_details':
      case 'bank_statement':
        // Sync bank details to staff table
        const { bankName, bankAccountNumber, bankBranchCode, bankAccountType, bankAccountHolder } = ocrMetadata;

        if (bankName || bankAccountNumber || bankBranchCode || bankAccountType || bankAccountHolder) {
          await sql`
            UPDATE staff
            SET
              bank_name = COALESCE(${bankName || null}, bank_name),
              bank_account_number = COALESCE(${bankAccountNumber || null}, bank_account_number),
              bank_branch_code = COALESCE(${bankBranchCode || null}, bank_branch_code),
              bank_account_type = COALESCE(${bankAccountType?.toLowerCase() || null}, bank_account_type),
              bank_account_holder = COALESCE(${bankAccountHolder || null}, bank_account_holder),
              bank_details_verified_at = NOW(),
              updated_at = NOW()
            WHERE id = ${staffId}
          `;
          logger.info('Synced bank details from verified document', {
            staffId,
            documentType,
            bankName,
            accountNumber: bankAccountNumber ? `****${bankAccountNumber.slice(-4)}` : null,
          });
        }
        break;

      default:
        break;
    }
  } catch (error) {
    // Log but don't fail verification if sync fails
    logger.warn('Failed to sync OCR metadata to staff table', {
      staffId,
      documentType,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Record HITL corrections when a human edits OCR-extracted values during verification
 * These corrections are used as few-shot examples to improve future VLM extractions
 */
async function recordOcrCorrectionsFromVerification(
  documentType: string,
  originalOcr: Record<string, string>,
  editedOcr: Record<string, string>,
  documentId: string,
  correctedBy: string
): Promise<void> {
  try {
    const corrections = [];

    // Compare all fields and record any that were changed
    for (const [fieldName, correctedValue] of Object.entries(editedOcr)) {
      const originalValue = originalOcr[fieldName];

      // Skip if values are the same (no correction made)
      if (originalValue === correctedValue) continue;

      // Skip empty corrections
      if (!correctedValue || correctedValue.trim() === '') continue;

      corrections.push({
        moduleName: 'staff_documents',
        documentType,
        fieldName,
        vlmExtractedValue: originalValue || null,
        correctedValue: correctedValue.trim(),
        correctedBy,
        sourceRecordId: documentId,
        sourceTable: 'staff_documents',
        correctionReason: originalValue
          ? `Human corrected "${originalValue}" to "${correctedValue}" during document verification`
          : `Human added value "${correctedValue}" that was not detected by OCR`,
      });
    }

    if (corrections.length > 0) {
      await recordOcrCorrections(corrections);
      logger.info('Recorded HITL OCR corrections', {
        documentType,
        correctionCount: corrections.length,
        fields: corrections.map(c => c.fieldName),
      });
    }
  } catch (error) {
    // Don't fail verification if HITL recording fails
    logger.warn('Failed to record HITL OCR corrections', {
      documentType,
      documentId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
