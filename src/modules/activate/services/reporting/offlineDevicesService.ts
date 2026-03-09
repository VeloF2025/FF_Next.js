/**
 * Offline Devices Report
 */

import { log } from '@/lib/logger';
import { pool } from './_shared';
import type {
  OfflineDevicesReportResponse,
  OfflineDeviceRecord,
  OfflineDevicesSummary,
  OfflineMatchStatus,
} from '../../types/reporting.types';

/**
 * Get offline devices report with filtering and pagination
 */
export async function getOfflineDevicesReport(
  dateFrom: string,
  dateTo: string,
  options: {
    project?: string;
    zone?: string;
    offlineBucket?: string;
    matchStatus?: OfflineMatchStatus;
    serialMismatchOnly?: boolean;
    lastDownReason?: string;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<OfflineDevicesReportResponse> {
  try {
    const {
      project,
      zone,
      offlineBucket,
      matchStatus,
      serialMismatchOnly,
      lastDownReason,
      page = 1,
      pageSize = 100,
    } = options;

    log.info('Getting offline devices report', {
      dateFrom,
      dateTo,
      ...options,
    }, 'ReportingService');

    // Build WHERE conditions
    const conditions: string[] = [
      'od.report_date >= $1::DATE',
      'od.report_date <= $2::DATE',
    ];
    const params: (string | number | boolean)[] = [dateFrom, dateTo];
    let paramIdx = 3;

    if (zone) {
      conditions.push(`od.zone = $${paramIdx}`);
      params.push(zone);
      paramIdx++;
    }

    if (offlineBucket) {
      conditions.push(`od.offline_bucket = $${paramIdx}`);
      params.push(offlineBucket);
      paramIdx++;
    }

    if (matchStatus) {
      conditions.push(`od.match_status = $${paramIdx}`);
      params.push(matchStatus);
      paramIdx++;
    }

    if (serialMismatchOnly) {
      conditions.push('od.serial_mismatch = true');
    }

    if (lastDownReason) {
      conditions.push(`od.last_down_reason = $${paramIdx}`);
      params.push(lastDownReason);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    // Get summary stats
    const summaryResult = await pool.query(
      `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE od.match_status = 'matched_drops') as matched_drops,
        COUNT(*) FILTER (WHERE od.match_status = 'matched_oes') as matched_oes,
        COUNT(*) FILTER (WHERE od.match_status = 'unmatched') as unmatched,
        COUNT(*) FILTER (WHERE od.serial_mismatch = true) as serial_mismatches
      FROM offline_devices od
      WHERE ${whereClause}
      `,
      params
    );

    const summaryRow = summaryResult.rows[0] || {};

    // Get bucket breakdown
    const bucketResult = await pool.query(
      `
      SELECT od.offline_bucket, COUNT(*) as count
      FROM offline_devices od
      WHERE ${whereClause}
      GROUP BY od.offline_bucket
      ORDER BY od.offline_bucket
      `,
      params
    );

    const byBucket: Record<string, number> = {};
    for (const row of bucketResult.rows) {
      if (row.offline_bucket) {
        byBucket[row.offline_bucket] = parseInt(row.count, 10) || 0;
      }
    }

    // Get reason breakdown
    const reasonResult = await pool.query(
      `
      SELECT od.last_down_reason, COUNT(*) as count
      FROM offline_devices od
      WHERE ${whereClause}
      GROUP BY od.last_down_reason
      ORDER BY count DESC
      LIMIT 20
      `,
      params
    );

    const byReason: Record<string, number> = {};
    for (const row of reasonResult.rows) {
      byReason[row.last_down_reason] = parseInt(row.count, 10) || 0;
    }

    // Get zone breakdown
    const zoneResult = await pool.query(
      `
      SELECT od.zone, COUNT(*) as count
      FROM offline_devices od
      WHERE ${whereClause} AND od.zone IS NOT NULL
      GROUP BY od.zone
      ORDER BY od.zone
      `,
      params
    );

    const byZone: Record<string, number> = {};
    for (const row of zoneResult.rows) {
      byZone[row.zone] = parseInt(row.count, 10) || 0;
    }

    // Get available filter options
    const zonesResult = await pool.query(
      `SELECT DISTINCT zone FROM offline_devices WHERE zone IS NOT NULL AND report_date >= $1 AND report_date <= $2 ORDER BY zone`,
      [dateFrom, dateTo]
    );
    const availableZones = zonesResult.rows.map((r) => r.zone);

    const reasonsResult = await pool.query(
      `SELECT DISTINCT last_down_reason FROM offline_devices WHERE report_date >= $1 AND report_date <= $2 ORDER BY last_down_reason`,
      [dateFrom, dateTo]
    );
    const availableReasons = reasonsResult.rows.map((r) => r.last_down_reason);

    const bucketsResult = await pool.query(
      `SELECT DISTINCT offline_bucket FROM offline_devices WHERE offline_bucket IS NOT NULL AND report_date >= $1 AND report_date <= $2 ORDER BY offline_bucket`,
      [dateFrom, dateTo]
    );
    const availableBuckets = bucketsResult.rows.map((r) => r.offline_bucket);

    // Get paginated records
    const offset = (page - 1) * pageSize;
    const recordsResult = await pool.query(
      `
      SELECT
        od.id,
        od.drop_number,
        od.serial_number,
        od.area_code,
        od.zone,
        od.planned_pon,
        od.address,
        od.pole_number,
        od.last_down_reason,
        od.last_inform_date,
        od.days_since_last_inform,
        od.offline_bucket,
        od.match_status,
        od.expected_serial,
        od.serial_mismatch,
        od.report_date,
        od.installation_date,
        od.revenue_30day_avg
      FROM offline_devices od
      WHERE ${whereClause}
      ORDER BY od.days_since_last_inform DESC, od.drop_number
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
      `,
      [...params, pageSize, offset]
    );

    const records: OfflineDeviceRecord[] = recordsResult.rows.map((row) => ({
      id: row.id,
      drop_number: row.drop_number,
      serial_number: row.serial_number,
      area_code: row.area_code,
      zone: row.zone,
      planned_pon: row.planned_pon,
      address: row.address,
      pole_number: row.pole_number,
      last_down_reason: row.last_down_reason,
      last_inform_date: row.last_inform_date
        ? new Date(row.last_inform_date).toISOString()
        : null,
      days_since_last_inform: parseInt(row.days_since_last_inform, 10) || 0,
      offline_bucket: row.offline_bucket,
      match_status: row.match_status as OfflineMatchStatus,
      expected_serial: row.expected_serial,
      serial_mismatch: row.serial_mismatch === true,
      report_date: row.report_date,
      installation_date: row.installation_date,
      revenue_30day_avg: row.revenue_30day_avg
        ? parseFloat(row.revenue_30day_avg)
        : null,
    }));

    const summary: OfflineDevicesSummary = {
      total_devices: parseInt(summaryRow.total, 10) || 0,
      matched_drops: parseInt(summaryRow.matched_drops, 10) || 0,
      matched_oes: parseInt(summaryRow.matched_oes, 10) || 0,
      unmatched: parseInt(summaryRow.unmatched, 10) || 0,
      serial_mismatches: parseInt(summaryRow.serial_mismatches, 10) || 0,
      by_bucket: byBucket,
      by_reason: byReason,
      by_zone: byZone,
    };

    return {
      date_range: { from: dateFrom, to: dateTo },
      project: project || null,
      summary,
      available_zones: availableZones,
      available_reasons: availableReasons,
      available_buckets: availableBuckets,
      records,
      total_count: parseInt(summaryRow.total, 10) || 0,
      page,
      page_size: pageSize,
    };
  } catch (error) {
    log.error('Failed to get offline devices report', { error }, 'ReportingService');
    throw error;
  }
}
