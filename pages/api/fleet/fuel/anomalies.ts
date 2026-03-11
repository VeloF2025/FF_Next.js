/**
 * Fleet Fuel Anomalies API
 * GET /api/fleet/fuel/anomalies - List anomalies
 * POST /api/fleet/fuel/anomalies - Run anomaly detection
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { getFuelAnomalies, runAnomalyDetection } from '@/modules/fleet/services';
import type { AnomalyStatus, AnomalySeverity } from '@/modules/fleet/types/fuel-analytics.types';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const {
        vehicleId,
        status,
        severity,
        startDate,
        endDate,
        limit = '50',
        offset = '0',
      } = req.query;

      const result = await getFuelAnomalies({
        vehicleId: vehicleId as string | undefined,
        status: status as AnomalyStatus | undefined,
        severity: severity as AnomalySeverity | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
      });

      return apiResponse.success(res, result);
    } catch (error) {
      log.error('FleetFuelAnomaliesApi', 'Failed to fetch fuel anomalies', { error });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'POST') {
    try {
      const { vehicleId, lookbackDays, thresholds } = req.body;

      const result = await runAnomalyDetection({
        vehicleId,
        lookbackDays,
        thresholds,
      });

      return apiResponse.success(res, result);
    } catch (error) {
      log.error('FleetFuelAnomaliesApi', 'Failed to run anomaly detection', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'unknown');
}

export default withAuth(handler);
