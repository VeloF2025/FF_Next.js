/**
 * Fleet Mileage Export API
 * GET /api/fleet/mileage/export - Download mileage report as Excel
 *
 * Same params as /api/fleet/mileage: period, startDate, endDate, projectId
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as XLSX from 'xlsx';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getFleetMileage } from '@/modules/fleet/services';
import { withAuth } from '@/lib/auth';
import type { MileagePeriod } from '@/modules/fleet/types';
import { getDefaultDateRange, isValidDate } from '@/modules/fleet/services/mileageUtils';

const VALID_PERIODS: MileagePeriod[] = ['daily', 'weekly', 'monthly', 'custom'];

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { period: periodParam = 'monthly', startDate: startParam, endDate: endParam, projectId } = req.query;
    const period = periodParam as MileagePeriod;

    if (!VALID_PERIODS.includes(period)) {
      return apiResponse.validationError(res, { period: 'Invalid period' });
    }

    let startDate: string;
    let endDate: string;

    if (period === 'custom') {
      if (!startParam || !endParam) {
        return apiResponse.validationError(res, { dates: 'startDate and endDate required for custom period' });
      }
      startDate = startParam as string;
      endDate = endParam as string;
    } else {
      const defaults = getDefaultDateRange(period);
      startDate = (startParam as string) || defaults.startDate;
      endDate = (endParam as string) || defaults.endDate;
    }

    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return apiResponse.validationError(res, { dates: 'Dates must be in YYYY-MM-DD format' });
    }

    const report = await getFleetMileage(period, startDate, endDate, projectId as string | undefined);

    // Sheet 1: Vehicle Mileage
    const vehicleHeaders = ['Registration', 'Make', 'Model', 'Year', 'Status', 'Total KM', 'Readings', 'Avg KM/Day', 'Latest Reading'];
    const vehicleData = report.vehicles.map(v => [
      v.registration,
      v.make || '',
      v.model || '',
      v.year || '',
      v.status,
      v.totalKm,
      v.readingsCount,
      v.averagePerDay,
      v.latestReading,
    ]);

    const wsVehicles = XLSX.utils.aoa_to_sheet([vehicleHeaders, ...vehicleData]);
    wsVehicles['!cols'] = [
      { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 6 }, { wch: 10 },
      { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 },
    ];

    // Sheet 2: Period Breakdown
    const periodHeaders = ['Period', 'Total KM', 'Readings'];
    const periodData = report.periodBreakdown.map(p => [
      p.periodLabel,
      p.totalKm,
      p.readingsCount,
    ]);

    const wsPeriods = XLSX.utils.aoa_to_sheet([periodHeaders, ...periodData]);
    wsPeriods['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 10 }];

    // Build workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsVehicles, 'Vehicle Mileage');
    XLSX.utils.book_append_sheet(wb, wsPeriods, 'Period Breakdown');

    const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    const projectSuffix = report.projectName ? `-${report.projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
    const filename = `fleet-mileage-${period}-${startDate}-to-${endDate}${projectSuffix}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    log.info('Fleet mileage export generated', { period, startDate, endDate, vehicleCount: report.vehicles.length });

    return res.status(200).send(buffer);
  } catch (error) {
    log.error('Failed to export fleet mileage', { error });
    return apiResponse.internalError(res, error);
  }
}));
