/**
 * Supplier Compliance API endpoint
 * Handles compliance document operations for specific suppliers
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { NeonSupplierService } from '@/services/suppliers/neonSupplierService';
import { DocumentType } from '@/types/supplier/base.types';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { supplierId: id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Invalid supplier ID');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(id, res);
      case 'POST':
        return handlePost(id, req, res);
      case 'PUT':
        return handlePut(id, req, res);
      case 'DELETE':
        return handleDelete(id, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST', 'PUT', 'DELETE']);
    }
  } catch (error) {
    log.error(`Supplier compliance API error for ${id}:`, { data: error }, 'api');
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function handleGet(id: string, res: NextApiResponse) {
  try {
    // Get all compliance documents for the supplier
    const documents = await sql`
      SELECT 
        id,
        doc_type,
        doc_name,
        doc_number,
        doc_url,
        status,
        verification_status,
        issue_date,
        expiry_date,
        issuing_body,
        verified_by,
        verified_at,
        verification_notes,
        rejection_reason,
        uploaded_by,
        uploaded_at,
        updated_at,
        CASE 
          WHEN expiry_date IS NOT NULL AND expiry_date < NOW() THEN 'expired'
          WHEN expiry_date IS NOT NULL AND expiry_date < NOW() + INTERVAL '30 days' THEN 'expiring_soon'
          ELSE 'valid'
        END as validity_status
      FROM supplier_compliance
      WHERE supplier_id = ${parseInt(id)}
      ORDER BY uploaded_at DESC
    `;

    // Get compliance summary
    const summary = await sql`
      SELECT 
        COUNT(*) as total_documents,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_documents,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_documents,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected_documents,
        COUNT(*) FILTER (WHERE expiry_date < NOW()) as expired_documents,
        COUNT(*) FILTER (WHERE expiry_date BETWEEN NOW() AND NOW() + INTERVAL '30 days') as expiring_soon
      FROM supplier_compliance
      WHERE supplier_id = ${parseInt(id)}
    `;

    // Get supplier compliance status
    const supplier = await sql`
      SELECT 
        tax_compliant,
        bee_compliant,
        bee_level,
        insurance_valid,
        documents_verified,
        last_audit_date,
        next_audit_date
      FROM suppliers
      WHERE id = ${parseInt(id)}
    `;

    return res.status(200).json({
      success: true,
      data: {
        documents,
        summary: summary[0],
        complianceStatus: supplier[0] || {}
      }
    });
  } catch (error) {
    log.error(`Error fetching compliance for supplier ${id}:`, { data: error }, 'api');
    throw error;
  }
}

async function handlePost(id: string, req: NextApiRequest, res: NextApiResponse) {
  try {
    const { document } = req.body;
    const userId = (req as any).user?.id;
    
    if (!document || !document.type || !document.name || !document.url) {
      return res.status(400).json({
        error: 'Missing required document data',
        required: ['type', 'name', 'url']
      });
    }

    // Validate document type
    if (!Object.values(DocumentType).includes(document.type)) {
      return res.status(400).json({
        error: 'Invalid document type',
        validTypes: Object.values(DocumentType)
      });
    }

    const actualUserId = userId || 'system'; // userId already from req.user above

    // Add the document
    await NeonSupplierService.addComplianceDocument(
      id,
      {
        type: document.type,
        name: document.name,
        url: document.url,
        expiryDate: document.expiryDate ? new Date(document.expiryDate) : undefined
      },
      actualUserId
    );
    
    return res.status(201).json({
      success: true,
      message: 'Compliance document added successfully'
    });
  } catch (error) {
    log.error(`Error adding compliance document for supplier ${id}:`, { data: error }, 'api');
    throw error;
  }
}

async function handlePut(id: string, req: NextApiRequest, res: NextApiResponse) {
  try {
    const { documentId, action, data } = req.body;
    const userId = (req as any).user?.id;
    
    if (!documentId) {
      return apiResponse.badRequest(res, 'Missing document ID');
    }

    const actualUserId = userId || 'system'; // userId already from req.user above

    switch (action) {
      case 'verify':
        await sql`
          UPDATE supplier_compliance
          SET 
            verification_status = 'verified',
            status = 'approved',
            verified_by = ${actualUserId},
            verified_at = NOW(),
            verification_notes = ${data?.notes || null}
          WHERE id = ${parseInt(documentId)} AND supplier_id = ${parseInt(id)}
        `;
        break;

      case 'reject':
        await sql`
          UPDATE supplier_compliance
          SET 
            verification_status = 'rejected',
            status = 'rejected',
            verified_by = ${actualUserId},
            verified_at = NOW(),
            rejection_reason = ${data?.reason || 'Document rejected'}
          WHERE id = ${parseInt(documentId)} AND supplier_id = ${parseInt(id)}
        `;
        break;

       case 'update': {
         // Handle individual field updates
         if (data?.expiryDate !== undefined) {
           await sql`
             UPDATE supplier_compliance
             SET expiry_date = ${data.expiryDate ? new Date(data.expiryDate) : null}, updated_at = NOW()
             WHERE id = ${parseInt(documentId)} AND supplier_id = ${parseInt(id)}
           `;
         }

         if (data?.docNumber !== undefined) {
           await sql`
             UPDATE supplier_compliance
             SET doc_number = ${data.docNumber}, updated_at = NOW()
             WHERE id = ${parseInt(documentId)} AND supplier_id = ${parseInt(id)}
           `;
         }

         if (data?.issuingBody !== undefined) {
           await sql`
             UPDATE supplier_compliance
             SET issuing_body = ${data.issuingBody}, updated_at = NOW()
             WHERE id = ${parseInt(documentId)} AND supplier_id = ${parseInt(id)}
           `;
         }
         break;
       }

      default:
        return res.status(400).json({
          error: 'Invalid action',
          validActions: ['verify', 'reject', 'update']
        });
    }

    // Update supplier compliance status
    await NeonSupplierService.updateComplianceStatus(id);
    
    return res.status(200).json({
      success: true,
      message: `Document ${action} completed successfully`
    });
  } catch (error) {
    log.error(`Error updating compliance document for supplier ${id}:`, { data: error }, 'api');
    throw error;
  }
}

async function handleDelete(id: string, req: NextApiRequest, res: NextApiResponse) {
  try {
    const { documentId } = req.body;
    
    if (!documentId) {
      return apiResponse.badRequest(res, 'Missing document ID');
    }

    await sql`
      DELETE FROM supplier_compliance
      WHERE id = ${parseInt(documentId)} AND supplier_id = ${parseInt(id)}
    `;

    // Update supplier compliance status
    await NeonSupplierService.updateComplianceStatus(id);
    
    return res.status(200).json({
      success: true,
      message: 'Compliance document deleted successfully'
    });
  } catch (error) {
    log.error(`Error deleting compliance document for supplier ${id}:`, { data: error }, 'api');
    throw error;
  }
}

export default withAuth(handler);