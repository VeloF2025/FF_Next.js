/**
 * Fleet Check-In Audit Trail API
 * Returns check-in records with VLM results, validation status, and discrepancies
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

interface AuditFilters {
  vehicleId?: string;
  driverId?: string;
  status?: 'all' | 'completed' | 'in_progress' | 'rejected';
  hasDiscrepancy?: boolean;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const {
      vehicleId,
      driverId,
      status = 'all',
      hasDiscrepancy,
      dateFrom,
      dateTo,
      page = '1',
      pageSize = '50',
    } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limit = Math.min(parseInt(pageSize as string, 10) || 50, 100);
    const offset = (pageNum - 1) * limit;

    // Build dynamic filters
    const filters: string[] = [];
    const params: (string | boolean | number)[] = [];
    let paramIndex = 1;

    if (vehicleId) {
      filters.push(`cr.vehicle_id = $${paramIndex++}`);
      params.push(vehicleId as string);
    }

    if (driverId) {
      filters.push(`cr.driver_id = $${paramIndex++}`);
      params.push(driverId as string);
    }

    if (status && status !== 'all') {
      filters.push(`cr.status = $${paramIndex++}`);
      params.push(status as string);
    }

    if (dateFrom) {
      filters.push(`cr.check_date >= $${paramIndex++}`);
      params.push(dateFrom as string);
    }

    if (dateTo) {
      filters.push(`cr.check_date <= $${paramIndex++}`);
      params.push(dateTo as string);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM fleet_check_records cr
      ${whereClause}
    `;

    // Get audit records with VLM results and discrepancies
    const dataQuery = `
      SELECT
        cr.id,
        cr.vehicle_id,
        fv.registration,
        fv.make,
        fv.model,
        cr.driver_id,
        cr.driver_name,
        cr.check_type,
        cr.check_date,
        cr.check_time,
        cr.odometer_reading,
        cr.status,
        cr.has_critical_issues,
        cr.has_minor_issues,
        cr.approved_by,
        cr.approved_at,
        cr.approval_notes,
        cr.created_at,
        cr.updated_at,
        -- Aggregate VLM results
        (
          SELECT json_agg(json_build_object(
            'id', pvr.id,
            'analysisType', pvr.analysis_type,
            'extractedValue', pvr.extracted_value,
            'extractedNumeric', pvr.extracted_numeric,
            'confidence', pvr.confidence,
            'status', pvr.processing_status,
            'error', pvr.error_message,
            'rawResponse', pvr.raw_response,
            'verified', pvr.verified,
            'overrideValue', pvr.override_value,
            'createdAt', pvr.created_at
          ))
          FROM fleet_photo_vlm_results pvr
          JOIN fleet_check_photos fcp ON fcp.id = pvr.photo_id
          WHERE fcp.record_id = cr.id
        ) as vlm_results,
        -- Get odometer history with discrepancies
        (
          SELECT json_build_object(
            'reading', oh.reading,
            'previousReading', oh.previous_reading,
            'kmSinceLast', oh.km_since_last,
            'discrepancyFlag', oh.discrepancy_flag,
            'discrepancyReason', oh.discrepancy_reason,
            'vlmConfidence', oh.vlm_confidence,
            'source', oh.source,
            'recordedAt', oh.recorded_at
          )
          FROM fleet_odometer_history oh
          WHERE oh.check_record_id = cr.id
          ORDER BY oh.recorded_at DESC
          LIMIT 1
        ) as odometer_history
      FROM fleet_check_records cr
      JOIN fleet_vehicles fv ON fv.id = cr.vehicle_id
      ${whereClause}
      ORDER BY cr.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // Execute queries - use sql.query() for parameterized dynamic SQL
    const [countResult, records] = await Promise.all([
      sql.query(countQuery, params) as Promise<{ total: string }[]>,
      sql.query(dataQuery, params) as Promise<Record<string, unknown>[]>,
    ]);

    const total = parseInt(countResult[0]?.total || '0', 10);

    // Filter by discrepancy if requested
    let filteredRecords = records;
    if (hasDiscrepancy === 'true') {
      filteredRecords = records.filter((r: Record<string, unknown>) => {
        const history = r.odometer_history as { discrepancyFlag?: boolean } | null;
        return history?.discrepancyFlag === true;
      });
    }

    // Get summary stats
    const statsQuery = `
      SELECT
        COUNT(*) as total_records,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN has_critical_issues = true THEN 1 END) as with_critical_issues,
        COUNT(CASE WHEN has_minor_issues = true THEN 1 END) as with_minor_issues
      FROM fleet_check_records cr
      ${whereClause}
    `;

    // Build discrepancy stats query with optional date filters
    const discrepancyFilters: string[] = ['discrepancy_flag = true'];
    const discrepancyParams: string[] = [];
    let discrepancyParamIndex = 1;

    if (dateFrom) {
      discrepancyFilters.push(`recorded_at >= $${discrepancyParamIndex++}`);
      discrepancyParams.push(dateFrom as string);
    }
    if (dateTo) {
      discrepancyFilters.push(`recorded_at <= $${discrepancyParamIndex++}`);
      discrepancyParams.push(dateTo as string);
    }

    const discrepancyStatsQuery = `
      SELECT
        COUNT(*) as total_discrepancies,
        COUNT(CASE WHEN discrepancy_reason LIKE '%digit confusion%' THEN 1 END) as digit_confusion,
        COUNT(CASE WHEN discrepancy_reason LIKE '%rollback%' THEN 1 END) as rollback,
        COUNT(CASE WHEN discrepancy_reason LIKE '%Excessive%' THEN 1 END) as excessive_km
      FROM fleet_odometer_history
      WHERE ${discrepancyFilters.join(' AND ')}
    `;

    const [stats, discrepancyStats] = await Promise.all([
      sql.query(statsQuery, params) as Promise<Record<string, unknown>[]>,
      sql.query(discrepancyStatsQuery, discrepancyParams) as Promise<Record<string, unknown>[]>,
    ]);

    log.info('FleetAuditApi', `Fetched ${filteredRecords.length} audit records (page ${pageNum})`);

    return apiResponse.success(res, {
      records: filteredRecords,
      pagination: {
        page: pageNum,
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stats: stats[0],
      discrepancyStats: discrepancyStats[0],
    });
  } catch (error) {
    log.error('FleetAuditApi', `Audit fetch failed: ${error}`);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
