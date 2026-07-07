/**
 * API Route: /api/activate/reporting/offline-devices
 *
 * Purpose: Get offline devices report with filtering and pagination
 * Method: GET
 *
 * Query Parameters:
 * - dateFrom (required): Start date (YYYY-MM-DD)
 * - dateTo (required): End date (YYYY-MM-DD)
 * - project (optional): Filter by project name
 * - zone (optional): Filter by zone
 * - offlineBucket (optional): Filter by offline bucket
 * - matchStatus (optional): Filter by match status (matched_drops, matched_oes, unmatched)
 * - serialMismatchOnly (optional): Only show serial mismatches (true/false)
 * - lastDownReason (optional): Filter by last down reason
 * - page (optional): Page number (default: 1)
 * - pageSize (optional): Page size (default: 100, max: 500)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import ExcelJS from 'exceljs';
import { getOfflineDevicesReport } from '@/modules/activate/services/reportingService';
import type { OfflineMatchStatus } from '@/modules/activate/types/reporting.types';
import { log } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { gpsCoordinates, applyTicketRowLinks } from '@/lib/excel/ticketLinkCells';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);
  }

  try {
    const {
      dateFrom,
      dateTo,
      project,
      zone,
      offlineBucket,
      matchStatus,
      serialMismatchOnly,
      lastDownReason,
      page,
      pageSize,
    } = req.query;

    // Validate required parameters
    if (!dateFrom || !dateTo) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
    }

    const dateFromStr = Array.isArray(dateFrom) ? dateFrom[0] : dateFrom;
    const dateToStr = Array.isArray(dateTo) ? dateTo[0] : dateTo;
    const projectStr = project
      ? Array.isArray(project)
        ? project[0]
        : project
      : undefined;
    const zoneStr = zone
      ? Array.isArray(zone)
        ? zone[0]
        : zone
      : undefined;
    const offlineBucketStr = offlineBucket
      ? Array.isArray(offlineBucket)
        ? offlineBucket[0]
        : offlineBucket
      : undefined;
    const matchStatusStr = matchStatus
      ? (Array.isArray(matchStatus)
          ? matchStatus[0]
          : matchStatus) as OfflineMatchStatus
      : undefined;
    const serialMismatchOnlyBool =
      serialMismatchOnly === 'true' || serialMismatchOnly === '1';
    const lastDownReasonStr = lastDownReason
      ? Array.isArray(lastDownReason)
        ? lastDownReason[0]
        : lastDownReason
      : undefined;
    const pageNum = page
      ? parseInt(Array.isArray(page) ? (page[0] ?? '1') : page, 10)
      : 1;
    const pageSizeNum = pageSize
      ? Math.min(parseInt(Array.isArray(pageSize) ? (pageSize[0] ?? '100') : pageSize, 10), 500)
      : 100;
    const wantsCsv = (Array.isArray(req.query.format) ? req.query.format[0] : req.query.format) === 'csv';

    // Excel export: all filtered rows, minting share links on demand (server-side only).
    // Ticket / Ticket Link / GPS render as blue + underlined clickable hyperlinks.
    if (wantsCsv) {
      const report = await getOfflineDevicesReport(dateFromStr as string, dateToStr as string, {
        project: projectStr,
        zone: zoneStr,
        offlineBucket: offlineBucketStr,
        matchStatus: matchStatusStr,
        serialMismatchOnly: serialMismatchOnlyBool,
        lastDownReason: lastDownReasonStr,
        noPaging: true,
        mintShareLinks: true,
      });

      // 1-based link-cell columns: GPS=8, Ticket Number=15, Ticket Link=16.
      const headers = ['DR Number', 'Serial', '1Map Serial', 'Zone', 'PON', 'Address', 'Pole', 'GPS Coordinates', 'Down Reason', 'Days Offline', 'Bucket', 'Match Status', 'Serial Mismatch', 'Report Date', 'Ticket Number', 'Ticket Link'];
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Offline Devices');
      sheet.columns = headers.map((header) => ({ header, width: Math.max(12, Math.min(40, header.length + 4)) }));
      sheet.getRow(1).font = { bold: true };

      for (const r of report.records) {
        const added = sheet.addRow([
          r.drop_number,
          r.serial_number ?? '',
          r.onemap_serial ?? '',
          r.zone ?? '',
          r.planned_pon ?? '',
          r.address ?? '',
          r.pole_number ?? '',
          gpsCoordinates(r.latitude, r.longitude),
          r.last_down_reason ?? '',
          r.days_since_last_inform,
          r.offline_bucket ?? '',
          r.match_status ?? '',
          r.serial_mismatch ? 'Yes' : 'No',
          r.report_date ?? '',
          r.ticket_uid ?? '',
          r.ticket_link ?? '',
        ]);
        applyTicketRowLinks(added, {
          ticketCol: 15, ticketId: r.ticket_id, ticketUid: r.ticket_uid,
          ticketLinkCol: 16, ticketLink: r.ticket_link,
          gpsCol: 8, lat: r.latitude, lng: r.longitude,
        });
      }

      const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
      const today = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="offline-devices-${today}.xlsx"`);
      res.setHeader('X-Export-Count', String(report.records.length));
      return res.status(200).send(buffer);
    }

    log.info('Fetching offline devices report', {
      dateFrom: dateFromStr,
      dateTo: dateToStr,
      project: projectStr,
      zone: zoneStr,
      offlineBucket: offlineBucketStr,
      matchStatus: matchStatusStr,
      serialMismatchOnly: serialMismatchOnlyBool,
      lastDownReason: lastDownReasonStr,
      page: pageNum,
      pageSize: pageSizeNum,
    }, 'OfflineDevicesAPI');


    const data = await getOfflineDevicesReport(
      dateFromStr as string,
      dateToStr as string,
      {
        project: projectStr,
        zone: zoneStr,
        offlineBucket: offlineBucketStr,
        matchStatus: matchStatusStr,
        serialMismatchOnly: serialMismatchOnlyBool,
        lastDownReason: lastDownReasonStr,
        page: pageNum,
        pageSize: pageSizeNum,
      }
    );

    return res.status(200).json(data);
  } catch (error) {
    log.error('Failed to fetch offline devices report', { error: { error } }, 'OfflineDevicesAPI');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('activate.reports', 'view')(handler));
