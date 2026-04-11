/**
 * Fleet Vehicle Fuel Transactions API
 * GET: List fuel transactions for a vehicle
 * POST: Add a new fuel transaction (with optional VLM receipt scanning)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withFleetAuth } from '@/lib/auth/middleware';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  extractFuelReceipt,
  extractOdometerReading,
  extractFuelLevel,
} from '@/modules/fleet/services/fleetVlmService';

// Increase body size limit for base64 encoded images (mobile photos can be 3-5MB)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const sql = neon(process.env.DATABASE_URL!);

// Database row type
interface FuelTransactionRow {
  id: string;
  vehicle_id: string;
  transaction_date: string;
  amount_rand: string;
  litres: string;
  price_per_litre: string | null;
  odometer_reading: number | null;
  km_since_last_fill: number | null;
  litres_per_100km: string | null;
  station_name: string | null;
  station_location: string | null;
  receipt_photo_url: string | null;
  receipt_photo_key: string | null;
  odometer_photo_url: string | null;
  odometer_photo_key: string | null;
  vlm_extracted: boolean;
  vlm_confidence: string | null;
  vlm_raw_result: unknown;
  vlm_verified: boolean;
  source: string;
  recorded_by: string | null;
  created_at: string;
}

// API response type
interface FuelTransaction {
  id: string;
  vehicleId: string;
  transactionDate: string;
  amountRand: number;
  litres: number;
  pricePerLitre: number | null;
  odometerReading: number | null;
  kmSinceLastFill: number | null;
  litresPer100km: number | null;
  stationName: string | null;
  stationLocation: string | null;
  receiptPhotoUrl: string | null;
  odometerPhotoUrl: string | null;
  vlmExtracted: boolean;
  vlmConfidence: number | null;
  vlmVerified: boolean;
  source: 'manual' | 'vlm' | 'hybrid';
  createdAt: string;
}

function rowToTransaction(row: FuelTransactionRow): FuelTransaction {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    transactionDate: row.transaction_date,
    amountRand: parseFloat(row.amount_rand),
    litres: parseFloat(row.litres),
    pricePerLitre: row.price_per_litre ? parseFloat(row.price_per_litre) : null,
    odometerReading: row.odometer_reading,
    kmSinceLastFill: row.km_since_last_fill,
    litresPer100km: row.litres_per_100km ? parseFloat(row.litres_per_100km) : null,
    stationName: row.station_name,
    stationLocation: row.station_location,
    receiptPhotoUrl: row.receipt_photo_url,
    odometerPhotoUrl: row.odometer_photo_url,
    vlmExtracted: row.vlm_extracted,
    vlmConfidence: row.vlm_confidence ? parseFloat(row.vlm_confidence) : null,
    vlmVerified: row.vlm_verified,
    source: row.source as 'manual' | 'vlm' | 'hybrid',
    createdAt: row.created_at,
  };
}

interface CreateTransactionRequest {
  transactionDate: string;
  amountRand: number;
  litres: number;
  pricePerLitre?: number;
  odometerReading?: number;
  stationName?: string;
  stationLocation?: string;
  receiptPhotoBase64?: string;
  receiptPhotoUrl?: string;
  odometerPhotoBase64?: string;
  odometerPhotoUrl?: string;
  gpsLat?: number;
  gpsLng?: number;
  captureTimestamp?: string;
  source?: 'manual' | 'vlm' | 'hybrid';
  fuelLevelAfter?: number; // Tank level after fill-up (0-100%)
}

interface VlmScanRequest {
  receiptPhotoBase64?: string;
  odometerPhotoBase64?: string;
  fuelGaugePhotoBase64?: string;
}

interface UpdateTransactionRequest {
  transactionId: string;
  transactionDate?: string;
  amountRand?: number;
  litres?: number;
  pricePerLitre?: number;
  odometerReading?: number;
  stationName?: string;
  stationLocation?: string;
  receiptPhotoUrl?: string;
  odometerPhotoUrl?: string;
}

async function handler(
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
      case 'PATCH':
        return handlePatch(req, res, vehicleId);
      case 'DELETE':
        return handleDelete(req, res, vehicleId);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET', 'POST', 'PATCH', 'DELETE']);
    }
  } catch (error) {
    log.error('Fleet fuel transactions API error', { error, vehicleId });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const { limit = '50', offset = '0' } = req.query;
  const limitNum = Math.min(parseInt(limit as string, 10), 100);
  const offsetNum = parseInt(offset as string, 10);

  // Paginated transactions, total count, and summary stats are all independent — run in parallel
  const [rows, countResult, statsResult] = await Promise.all([
    sql`
      SELECT id, vehicle_id, transaction_date, amount_rand, litres, price_per_litre,
             odometer_reading, km_since_last_fill, litres_per_100km,
             station_name, station_location, receipt_photo_url, receipt_photo_key,
             odometer_photo_url, odometer_photo_key, vlm_extracted, vlm_confidence,
             vlm_raw_result, vlm_verified, source, recorded_by, created_at
      FROM fleet_fuel_transactions
      WHERE vehicle_id = ${vehicleId}
      ORDER BY transaction_date DESC, created_at DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    ` as unknown as Promise<FuelTransactionRow[]>,
    sql`
      SELECT COUNT(*) as total FROM fleet_fuel_transactions
      WHERE vehicle_id = ${vehicleId}
    ` as unknown as Promise<Array<{ total: string }>>,
    sql`
      SELECT
        COALESCE(SUM(amount_rand), 0) as total_spent,
        COALESCE(SUM(litres), 0) as total_litres,
        COALESCE(AVG(litres_per_100km), 0) as avg_consumption,
        COUNT(*) as transaction_count
      FROM fleet_fuel_transactions
      WHERE vehicle_id = ${vehicleId}
    ` as unknown as Promise<Array<{
      total_spent: string;
      total_litres: string;
      avg_consumption: string;
      transaction_count: string;
    }>>,
  ]);

  const total = parseInt(countResult[0]?.total || '0', 10);
  const transactions = rows.map(rowToTransaction);
  const stats = statsResult[0]!;

  return apiResponse.success(res, {
    transactions,
    summary: {
      totalSpent: parseFloat(stats.total_spent),
      totalLitres: parseFloat(stats.total_litres),
      avgConsumption: parseFloat(stats.avg_consumption) || null,
      transactionCount: parseInt(stats.transaction_count, 10),
    },
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
  // Check if this is a VLM scan request
  if (req.query.action === 'scan') {
    return handleVlmScan(req, res, vehicleId);
  }

  const body = req.body as CreateTransactionRequest;

  // Validate required fields
  if (!body.transactionDate) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Transaction date is required');
  }
  if (body.amountRand === undefined || body.amountRand === null || body.amountRand <= 0) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Amount (Rand) must be a positive number');
  }
  if (body.litres === undefined || body.litres === null || body.litres <= 0) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Litres must be a positive number');
  }

  // Verify vehicle exists
  const vehicleCheck = await sql`
    SELECT id, registration FROM fleet_vehicles WHERE id = ${vehicleId}
  `;
  if (vehicleCheck.length === 0) {
    return apiResponse.notFound(res, 'Vehicle', vehicleId);
  }

  // Get previous transaction for km calculation
  // Find the transaction with the highest odometer reading LESS than the current one
  let previousOdometer: number | null = null;

  if (body.odometerReading) {
    const previousTx = await sql`
      SELECT odometer_reading FROM fleet_fuel_transactions
      WHERE vehicle_id = ${vehicleId}
        AND odometer_reading IS NOT NULL
        AND odometer_reading < ${body.odometerReading}
      ORDER BY odometer_reading DESC
      LIMIT 1
    ` as Array<{ odometer_reading: number }>;

    previousOdometer = previousTx[0]?.odometer_reading ?? null;
  }

  // Calculate fuel efficiency (only if we have both current and previous odometer)
  let kmSinceLastFill: number | null = null;
  let litresPer100km: number | null = null;

  if (body.odometerReading && previousOdometer) {
    kmSinceLastFill = body.odometerReading - previousOdometer;
    if (kmSinceLastFill > 0 && body.litres > 0) {
      litresPer100km = (body.litres / kmSinceLastFill) * 100;
    }
  }

  // Always calculate price per litre from amount/litres for accuracy
  // (VLM-extracted price may not match due to rounding on receipt)
  const pricePerLitre = body.amountRand / body.litres;

  const source = body.source || 'manual';

  // Insert transaction
  const rows = await sql`
    INSERT INTO fleet_fuel_transactions (
      vehicle_id,
      transaction_date,
      amount_rand,
      litres,
      price_per_litre,
      odometer_reading,
      km_since_last_fill,
      litres_per_100km,
      station_name,
      station_location,
      receipt_photo_url,
      odometer_photo_url,
      vlm_extracted,
      vlm_verified,
      source,
      gps_lat,
      gps_lng,
      capture_timestamp
    ) VALUES (
      ${vehicleId},
      ${body.transactionDate},
      ${body.amountRand},
      ${body.litres},
      ${pricePerLitre},
      ${body.odometerReading || null},
      ${kmSinceLastFill},
      ${litresPer100km},
      ${body.stationName || null},
      ${body.stationLocation || null},
      ${body.receiptPhotoUrl || null},
      ${body.odometerPhotoUrl || null},
      ${source !== 'manual'},
      ${source === 'manual'},
      ${source},
      ${body.gpsLat || null},
      ${body.gpsLng || null},
      ${body.captureTimestamp ? new Date(body.captureTimestamp) : new Date()}
    )
    RETURNING id, vehicle_id, transaction_date, amount_rand, litres, price_per_litre,
             odometer_reading, km_since_last_fill, litres_per_100km,
             station_name, station_location, receipt_photo_url, receipt_photo_key,
             odometer_photo_url, odometer_photo_key, vlm_extracted, vlm_confidence,
             vlm_raw_result, vlm_verified, source, recorded_by, created_at
  ` as FuelTransactionRow[];

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to create transaction');
  }

  const transaction = rowToTransaction(rows[0]);

  // Sync odometer reading to fleet_odometer_history for consistent stats
  if (body.odometerReading) {
    try {
      // Get previous reading from odometer history
      const prevReading = await sql`
        SELECT reading FROM fleet_odometer_history
        WHERE vehicle_id = ${vehicleId}
        ORDER BY recorded_at DESC
        LIMIT 1
      ` as Array<{ reading: number }>;

      const previousReading = prevReading[0]?.reading ?? null;
      const kmSinceLast = previousReading !== null ? body.odometerReading - previousReading : null;

      // Only insert if this reading is higher than the latest
      if (previousReading === null || body.odometerReading > previousReading) {
        await sql`
          INSERT INTO fleet_odometer_history (
            vehicle_id, reading, source, previous_reading, km_since_last, recorded_at
          ) VALUES (
            ${vehicleId}, ${body.odometerReading}, 'fuel_transaction', ${previousReading}, ${kmSinceLast}, NOW()
          )
        `;
        log.info('Synced fuel transaction odometer to history', { vehicleId, reading: body.odometerReading });
      }
    } catch (syncError) {
      // Log but don't fail the request - fuel transaction is primary
      log.warn('Failed to sync odometer to history', { error: syncError, vehicleId });
    }
  }

  // Sync fuel level to fleet_fuel_history if provided
  if (body.fuelLevelAfter !== undefined && body.fuelLevelAfter !== null) {
    try {
      // Get previous fuel level
      const prevLevel = await sql`
        SELECT fuel_level FROM fleet_fuel_history
        WHERE vehicle_id = ${vehicleId}
        ORDER BY recorded_at DESC
        LIMIT 1
      ` as Array<{ fuel_level: number }>;

      const previousLevel = prevLevel[0]?.fuel_level ?? null;
      const levelChange = previousLevel !== null ? body.fuelLevelAfter - previousLevel : null;

      await sql`
        INSERT INTO fleet_fuel_history (
          vehicle_id, fuel_level, previous_level, level_change, source, recorded_at
        ) VALUES (
          ${vehicleId}, ${body.fuelLevelAfter}, ${previousLevel}, ${levelChange}, 'fuel_transaction', NOW()
        )
      `;
      log.info('Synced fuel transaction level to history', { vehicleId, fuelLevel: body.fuelLevelAfter });
    } catch (syncError) {
      // Log but don't fail the request - fuel transaction is primary
      log.warn('Failed to sync fuel level to history', { error: syncError, vehicleId });
    }
  }

  log.info('Created fuel transaction', {
    vehicleId,
    amountRand: body.amountRand,
    litres: body.litres,
    source,
  });

  return apiResponse.created(res, {
    transaction,
    comparison: {
      previousOdometer,
      kmSinceLastFill,
      litresPer100km,
    },
  });
}

/**
 * Handle VLM scan request for receipt and/or odometer photos
 */
async function handleVlmScan(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const body = req.body as VlmScanRequest;

  if (!body.receiptPhotoBase64 && !body.odometerPhotoBase64 && !body.fuelGaugePhotoBase64) {
    return apiResponse.error(
      res,
      ErrorCode.BAD_REQUEST,
      'At least one photo (receipt, odometer, or fuel gauge) is required for scanning'
    );
  }

  const results: {
    receipt?: {
      amountRand: number | null;
      litres: number | null;
      pricePerLitre: number | null;
      date: string | null;
      stationName: string | null;
      stationLocation: string | null;
      fuelType: string | null;
      confidence: number;
      error?: string;
    };
    odometer?: {
      reading: number | null;
      confidence: number;
      rawText: string;
      error?: string;
    };
    fuelGauge?: {
      level: number | null;
      confidence: number;
      description: string;
      error?: string;
    };
  } = {};

  // Process receipt photo
  if (body.receiptPhotoBase64) {
    try {
      const receiptResult = await extractFuelReceipt(body.receiptPhotoBase64);
      results.receipt = receiptResult;
    } catch (error) {
      log.error('FleetVehicleFuelTransactionsApi', 'Failed to extract fuel receipt via VLM', { error });
      results.receipt = {
        amountRand: null,
        litres: null,
        pricePerLitre: null,
        date: null,
        stationName: null,
        stationLocation: null,
        fuelType: null,
        confidence: 0,
        error: error instanceof Error ? error.message : 'VLM extraction failed',
      };
    }
  }

  // Process odometer photo
  if (body.odometerPhotoBase64) {
    try {
      const odometerResult = await extractOdometerReading(body.odometerPhotoBase64);
      results.odometer = odometerResult;
    } catch (error) {
      log.error('FleetVehicleFuelTransactionsApi', 'Failed to extract odometer reading via VLM', { error });
      results.odometer = {
        reading: null,
        confidence: 0,
        rawText: '',
        error: error instanceof Error ? error.message : 'VLM extraction failed',
      };
    }
  }

  // Process fuel gauge photo
  if (body.fuelGaugePhotoBase64) {
    try {
      const fuelGaugeResult = await extractFuelLevel(body.fuelGaugePhotoBase64);
      results.fuelGauge = fuelGaugeResult;
    } catch (error) {
      log.error('FleetVehicleFuelTransactionsApi', 'Failed to extract fuel gauge reading via VLM', { error });
      results.fuelGauge = {
        level: null,
        confidence: 0,
        description: '',
        error: error instanceof Error ? error.message : 'VLM extraction failed',
      };
    }
  }

  log.info('VLM scan completed', {
    vehicleId,
    hasReceipt: !!body.receiptPhotoBase64,
    hasOdometer: !!body.odometerPhotoBase64,
    hasFuelGauge: !!body.fuelGaugePhotoBase64,
    receiptConfidence: results.receipt?.confidence ?? null,
    odometerConfidence: results.odometer?.confidence ?? null,
    fuelGaugeConfidence: results.fuelGauge?.confidence ?? null,
  });

  return apiResponse.success(res, {
    vlmResults: results,
    message: 'VLM scan completed. Review and confirm the extracted data before saving.',
  });
}

/**
 * Handle PATCH request for editing a fuel transaction
 */
async function handlePatch(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  const body = req.body as UpdateTransactionRequest;

  if (!body.transactionId) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Transaction ID is required');
  }

  // Verify transaction exists and belongs to this vehicle
  const existingTx = await sql`
    SELECT id, vehicle_id, transaction_date, amount_rand, litres, price_per_litre,
           odometer_reading, km_since_last_fill, litres_per_100km,
           station_name, station_location, receipt_photo_url, receipt_photo_key,
           odometer_photo_url, odometer_photo_key, vlm_extracted, vlm_confidence,
           vlm_raw_result, vlm_verified, source, recorded_by, created_at
    FROM fleet_fuel_transactions
    WHERE id = ${body.transactionId} AND vehicle_id = ${vehicleId}
  ` as FuelTransactionRow[];

  if (existingTx.length === 0) {
    return apiResponse.notFound(res, 'Fuel transaction', body.transactionId);
  }

  const current = existingTx[0]!;

  // Build update values
  const transactionDate = body.transactionDate || current.transaction_date;
  const amountRand = body.amountRand ?? parseFloat(current.amount_rand);
  const litres = body.litres ?? parseFloat(current.litres);
  // Always calculate price per litre from amount/litres for accuracy
  const pricePerLitre = amountRand / litres;
  const odometerReading = body.odometerReading ?? current.odometer_reading;
  const stationName = body.stationName !== undefined ? body.stationName : current.station_name;
  const stationLocation = body.stationLocation !== undefined ? body.stationLocation : current.station_location;
  const receiptPhotoUrl = body.receiptPhotoUrl !== undefined ? body.receiptPhotoUrl : current.receipt_photo_url;
  const odometerPhotoUrl = body.odometerPhotoUrl !== undefined ? body.odometerPhotoUrl : current.odometer_photo_url;

  // Recalculate km since last fill and consumption if odometer changed
  let kmSinceLastFill = current.km_since_last_fill;
  let litresPer100km = current.litres_per_100km ? parseFloat(current.litres_per_100km) : null;

  if (odometerReading !== current.odometer_reading && odometerReading) {
    // Find the transaction with the highest odometer reading LESS than the new one
    // Exclude the current transaction being edited
    const previousTx = await sql`
      SELECT odometer_reading FROM fleet_fuel_transactions
      WHERE vehicle_id = ${vehicleId}
        AND odometer_reading IS NOT NULL
        AND odometer_reading < ${odometerReading}
        AND id != ${body.transactionId}
      ORDER BY odometer_reading DESC
      LIMIT 1
    ` as Array<{ odometer_reading: number }>;

    const previousOdometer = previousTx[0]?.odometer_reading ?? null;

    if (previousOdometer) {
      kmSinceLastFill = odometerReading - previousOdometer;
      if (kmSinceLastFill > 0 && litres > 0) {
        litresPer100km = (litres / kmSinceLastFill) * 100;
      }
    } else {
      // No previous odometer - this is the first reading
      kmSinceLastFill = null;
      litresPer100km = null;
    }
  }

  // Update transaction
  const rows = await sql`
    UPDATE fleet_fuel_transactions
    SET
      transaction_date = ${transactionDate},
      amount_rand = ${amountRand},
      litres = ${litres},
      price_per_litre = ${pricePerLitre},
      odometer_reading = ${odometerReading},
      km_since_last_fill = ${kmSinceLastFill},
      litres_per_100km = ${litresPer100km},
      station_name = ${stationName},
      station_location = ${stationLocation},
      receipt_photo_url = ${receiptPhotoUrl},
      odometer_photo_url = ${odometerPhotoUrl}
    WHERE id = ${body.transactionId}
    RETURNING id, vehicle_id, transaction_date, amount_rand, litres, price_per_litre,
             odometer_reading, km_since_last_fill, litres_per_100km,
             station_name, station_location, receipt_photo_url, receipt_photo_key,
             odometer_photo_url, odometer_photo_key, vlm_extracted, vlm_confidence,
             vlm_raw_result, vlm_verified, source, recorded_by, created_at
  ` as FuelTransactionRow[];

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to update transaction');
  }

  const transaction = rowToTransaction(rows[0]);

  log.info('Updated fuel transaction', {
    vehicleId,
    transactionId: body.transactionId,
    amountRand,
    litres,
  });

  return apiResponse.success(res, { transaction });
}

/**
 * Handle DELETE request for deleting a fuel transaction (admin only)
 */
async function handleDelete(
  req: NextApiRequest,
  res: NextApiResponse,
  vehicleId: string
) {
  // Check if user is admin or super_admin
  const user = (req as unknown as { user?: { role?: string } }).user;
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return apiResponse.error(res, ErrorCode.FORBIDDEN, 'Only admins can delete fuel transactions');
  }

  const { transactionId } = req.body;

  if (!transactionId) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Transaction ID is required');
  }

  // Verify transaction exists and belongs to this vehicle
  const existingTx = await sql`
    SELECT id FROM fleet_fuel_transactions
    WHERE id = ${transactionId} AND vehicle_id = ${vehicleId}
  `;

  if (existingTx.length === 0) {
    return apiResponse.notFound(res, 'Fuel transaction', transactionId);
  }

  // Delete the transaction
  await sql`
    DELETE FROM fleet_fuel_transactions
    WHERE id = ${transactionId}
  `;

  // Recalculate L/100km for all remaining transactions
  const recalculated = await recalculateFuelEfficiency(vehicleId);

  log.info('Deleted fuel transaction', {
    vehicleId,
    transactionId,
    deletedBy: user.role,
    recalculatedCount: recalculated,
  });

  return apiResponse.success(res, { deleted: true, transactionId, recalculated });
}

/**
 * Recalculate L/100km for all transactions of a vehicle
 * Called after delete to ensure efficiency values are correct
 */
async function recalculateFuelEfficiency(vehicleId: string): Promise<number> {
  // Get all transactions with odometer readings, ordered by odometer
  const transactions = await sql`
    SELECT id, odometer_reading, litres
    FROM fleet_fuel_transactions
    WHERE vehicle_id = ${vehicleId}
      AND odometer_reading IS NOT NULL
    ORDER BY odometer_reading ASC
  ` as Array<{ id: string; odometer_reading: number; litres: string }>;

  if (transactions.length === 0) {
    return 0;
  }

  let updatedCount = 0;

  // First transaction has no previous - set to null
  await sql`
    UPDATE fleet_fuel_transactions
    SET km_since_last_fill = NULL, litres_per_100km = NULL
    WHERE id = ${transactions[0]!.id}
  `;

  // Calculate for each subsequent transaction
  for (let i = 1; i < transactions.length; i++) {
    const current = transactions[i]!;
    const previous = transactions[i - 1]!;

    const kmSinceLastFill = current.odometer_reading - previous.odometer_reading;
    const litres = parseFloat(current.litres);

    let litresPer100km: number | null = null;
    if (kmSinceLastFill > 0 && litres > 0) {
      litresPer100km = (litres / kmSinceLastFill) * 100;
    }

    await sql`
      UPDATE fleet_fuel_transactions
      SET km_since_last_fill = ${kmSinceLastFill},
          litres_per_100km = ${litresPer100km}
      WHERE id = ${current.id}
    `;
    updatedCount++;
  }

  log.info('Recalculated fuel efficiency', {
    vehicleId,
    totalTransactions: transactions.length,
    updatedCount,
  });

  return updatedCount;
}

export default withFleetAuth(handler);
