/**
 * GET /api/fleet/parking/compliance?from=&to=&result=
 *
 * Defaults to the last 7 days when no range is given. Dates are validated
 * strictly rather than coerced: a malformed `from` that fell through to a
 * default would quietly answer for the wrong period, which on a compliance
 * screen is worse than an error.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { loadCompliance } from '@/modules/fleet/parking/complianceQueries';
import { PARKING_CHECK_RESULTS } from '@/modules/fleet/parking/types';
import type { ParkingCheckResult } from '@/modules/fleet/parking/types';

const RESULTS: readonly ParkingCheckResult[] = PARKING_CHECK_RESULTS;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real calendar date in YYYY-MM-DD. */
function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function sastToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());
}

function daysAgo(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const today = sastToday();
  const rawFrom = req.query.from;
  const rawTo = req.query.to;
  const rawResult = req.query.result;

  const from = rawFrom === undefined ? daysAgo(today, 7) : rawFrom;
  const to = rawTo === undefined ? today : rawTo;
  if (typeof from !== 'string' || !isIsoDate(from) || typeof to !== 'string' || !isIsoDate(to)) {
    return apiResponse.badRequest(res, 'from and to must be YYYY-MM-DD dates');
  }
  if (from > to) {
    return apiResponse.badRequest(res, 'from must not be after to');
  }

  let result: ParkingCheckResult | undefined;
  if (rawResult !== undefined) {
    if (typeof rawResult !== 'string' || !RESULTS.includes(rawResult as ParkingCheckResult)) {
      return apiResponse.badRequest(res, `result must be one of: ${RESULTS.join(', ')}`);
    }
    result = rawResult as ParkingCheckResult;
  }

  try {
    return apiResponse.success(res, { rows: await loadCompliance({ from, to, result }) });
  } catch (err) {
    log.error('[fleet/parking] failed to load compliance rows', { error: err }, 'fleet');
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('fleet.parking', 'view')(handler));
