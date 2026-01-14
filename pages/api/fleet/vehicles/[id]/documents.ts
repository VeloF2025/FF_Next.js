/**
 * Fleet Vehicle Documents API
 * GET: List documents for a vehicle
 * POST: Add a new document
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type {
  VehicleDocument,
  VehicleDocumentRow,
  CreateDocumentRequest,
} from '@/modules/fleet/types';
import { rowToVehicleDocument } from '@/modules/fleet/types';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id: vehicleId } = req.query;

  if (!vehicleId || typeof vehicleId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Vehicle ID is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res, vehicleId);
      case 'POST':
        return handlePost(req, res, vehicleId);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET', 'POST']);
    }
  } catch (error) {
    log.error('Fleet documents API error', { error, vehicleId });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const { type, active } = req.query;

  let rows: VehicleDocumentRow[];

  // Handle different filter combinations with tagged templates
  if (type && typeof type === 'string' && active !== undefined) {
    const isActive = active === 'true';
    rows = await sql`
      SELECT * FROM fleet_vehicle_documents
      WHERE vehicle_id = ${vehicleId}
        AND document_type = ${type}
        AND is_active = ${isActive}
      ORDER BY created_at DESC
    ` as VehicleDocumentRow[];
  } else if (type && typeof type === 'string') {
    rows = await sql`
      SELECT * FROM fleet_vehicle_documents
      WHERE vehicle_id = ${vehicleId}
        AND document_type = ${type}
      ORDER BY created_at DESC
    ` as VehicleDocumentRow[];
  } else if (active !== undefined) {
    const isActive = active === 'true';
    rows = await sql`
      SELECT * FROM fleet_vehicle_documents
      WHERE vehicle_id = ${vehicleId}
        AND is_active = ${isActive}
      ORDER BY created_at DESC
    ` as VehicleDocumentRow[];
  } else {
    rows = await sql`
      SELECT * FROM fleet_vehicle_documents
      WHERE vehicle_id = ${vehicleId}
      ORDER BY created_at DESC
    ` as VehicleDocumentRow[];
  }

  const documents: VehicleDocument[] = rows.map(rowToVehicleDocument);

  return apiResponse.success(res, documents);
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const body = req.body as CreateDocumentRequest;

  // Validate required fields
  if (!body.documentType || !body.documentName) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Document type and name are required');
  }

  // Verify vehicle exists
  const vehicleCheck = await sql`
    SELECT id FROM fleet_vehicles WHERE id = ${vehicleId}
  `;
  if (vehicleCheck.length === 0) {
    return apiResponse.notFound(res, 'Vehicle', vehicleId);
  }

  const rows = await sql`
    INSERT INTO fleet_vehicle_documents (
      vehicle_id,
      document_type,
      document_name,
      description,
      file_url,
      file_size,
      mime_type,
      issue_date,
      expiry_date,
      reference_number,
      notes
    ) VALUES (
      ${vehicleId},
      ${body.documentType},
      ${body.documentName},
      ${body.description || null},
      ${body.fileUrl || null},
      ${body.fileSize || null},
      ${body.mimeType || null},
      ${body.issueDate || null},
      ${body.expiryDate || null},
      ${body.referenceNumber || null},
      ${body.notes || null}
    )
    RETURNING *
  ` as VehicleDocumentRow[];

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to create document');
  }

  const document = rowToVehicleDocument(rows[0]);

  log.info('Created vehicle document', {
    vehicleId,
    documentId: document.id,
    documentType: document.documentType,
  });

  return apiResponse.created(res, document);
}
