/**
 * Fleet Vehicle Photos API
 * GET: List all photos for a vehicle
 * POST: Upload a new photo for a vehicle
 *
 * All photos (odometer, licence plates, receipts, damage, etc.) are stored
 * under the specific vehicle for easy access and management.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

// Photo types
type VehiclePhotoType =
  | 'odometer'
  | 'licence_plate_front'
  | 'licence_plate_rear'
  | 'receipt'
  | 'dashboard'
  | 'exterior_front'
  | 'exterior_rear'
  | 'exterior_left'
  | 'exterior_right'
  | 'interior'
  | 'damage'
  | 'license_disk'
  | 'fuel_gauge';

// Database row type
interface VehiclePhotoRow {
  id: string;
  vehicle_id: string;
  photo_type: string;
  file_url: string;
  file_key: string | null;
  file_size: number | null;
  mime_type: string | null;
  check_record_id: string | null;
  fuel_transaction_id: string | null;
  vlm_processed: boolean;
  vlm_result: unknown;
  vlm_confidence: string | null;
  captured_at: string;
  captured_by: string | null;
  notes: string | null;
  created_at: string;
}

// API response type
interface VehiclePhoto {
  id: string;
  vehicleId: string;
  photoType: VehiclePhotoType;
  fileUrl: string;
  fileKey: string | null;
  fileSize: number | null;
  mimeType: string | null;
  checkRecordId: string | null;
  fuelTransactionId: string | null;
  vlmProcessed: boolean;
  vlmResult: unknown;
  vlmConfidence: number | null;
  capturedAt: string;
  capturedBy: string | null;
  notes: string | null;
  createdAt: string;
}

function rowToPhoto(row: VehiclePhotoRow): VehiclePhoto {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    photoType: row.photo_type as VehiclePhotoType,
    fileUrl: row.file_url,
    fileKey: row.file_key,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    checkRecordId: row.check_record_id,
    fuelTransactionId: row.fuel_transaction_id,
    vlmProcessed: row.vlm_processed,
    vlmResult: row.vlm_result,
    vlmConfidence: row.vlm_confidence ? parseFloat(row.vlm_confidence) : null,
    capturedAt: row.captured_at,
    capturedBy: row.captured_by,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

interface CreatePhotoRequest {
  photoType: VehiclePhotoType;
  fileUrl: string;
  fileKey?: string;
  fileSize?: number;
  mimeType?: string;
  checkRecordId?: string;
  fuelTransactionId?: string;
  vlmProcessed?: boolean;
  vlmResult?: unknown;
  vlmConfidence?: number;
  capturedAt?: string;
  capturedBy?: string;
  notes?: string;
}

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
    log.error('Fleet vehicle photos API error', { error, vehicleId });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const { type, limit = '50', offset = '0' } = req.query;
  const limitNum = Math.min(parseInt(limit as string, 10), 100);
  const offsetNum = parseInt(offset as string, 10);

  // Filter by photo type if provided
  let rows: VehiclePhotoRow[];
  let countResult: Array<{ total: string }>;

  if (type && typeof type === 'string') {
    rows = await sql`
      SELECT * FROM fleet_vehicle_photos
      WHERE vehicle_id = ${vehicleId} AND photo_type = ${type}
      ORDER BY captured_at DESC, created_at DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    ` as VehiclePhotoRow[];

    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_vehicle_photos
      WHERE vehicle_id = ${vehicleId} AND photo_type = ${type}
    ` as Array<{ total: string }>;
  } else {
    rows = await sql`
      SELECT * FROM fleet_vehicle_photos
      WHERE vehicle_id = ${vehicleId}
      ORDER BY captured_at DESC, created_at DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    ` as VehiclePhotoRow[];

    countResult = await sql`
      SELECT COUNT(*) as total FROM fleet_vehicle_photos
      WHERE vehicle_id = ${vehicleId}
    ` as Array<{ total: string }>;
  }

  // Get photo counts by type
  const typeCounts = await sql`
    SELECT photo_type, COUNT(*) as count
    FROM fleet_vehicle_photos
    WHERE vehicle_id = ${vehicleId}
    GROUP BY photo_type
    ORDER BY photo_type
  ` as Array<{ photo_type: string; count: string }>;

  const total = parseInt(countResult[0]?.total || '0', 10);
  const photos = rows.map(rowToPhoto);

  return apiResponse.success(res, {
    photos,
    byType: typeCounts.reduce(
      (acc, row) => ({ ...acc, [row.photo_type]: parseInt(row.count, 10) }),
      {} as Record<string, number>
    ),
    pagination: {
      page: Math.floor(offsetNum / limitNum) + 1,
      pageSize: limitNum,
      total,
    },
  });
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const body = req.body as CreatePhotoRequest;

  // Validate required fields
  if (!body.photoType) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Photo type is required');
  }
  if (!body.fileUrl) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'File URL is required');
  }

  // Verify vehicle exists
  const vehicleCheck = await sql`
    SELECT id, registration FROM fleet_vehicles WHERE id = ${vehicleId}
  `;
  if (vehicleCheck.length === 0) {
    return apiResponse.notFound(res, 'Vehicle', vehicleId);
  }

  // Insert photo record
  const rows = await sql`
    INSERT INTO fleet_vehicle_photos (
      vehicle_id,
      photo_type,
      file_url,
      file_key,
      file_size,
      mime_type,
      check_record_id,
      fuel_transaction_id,
      vlm_processed,
      vlm_result,
      vlm_confidence,
      captured_at,
      captured_by,
      notes
    ) VALUES (
      ${vehicleId},
      ${body.photoType},
      ${body.fileUrl},
      ${body.fileKey || null},
      ${body.fileSize || null},
      ${body.mimeType || null},
      ${body.checkRecordId || null},
      ${body.fuelTransactionId || null},
      ${body.vlmProcessed ?? false},
      ${body.vlmResult ? JSON.stringify(body.vlmResult) : null},
      ${body.vlmConfidence || null},
      ${body.capturedAt || new Date().toISOString()},
      ${body.capturedBy || null},
      ${body.notes || null}
    )
    RETURNING *
  ` as VehiclePhotoRow[];

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to create photo record');
  }

  const photo = rowToPhoto(rows[0]);

  log.info('Created vehicle photo record', {
    vehicleId,
    photoType: body.photoType,
    hasVlmResult: !!body.vlmResult,
  });

  return apiResponse.created(res, photo);
}
