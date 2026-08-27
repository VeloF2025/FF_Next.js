/**
 * GET /api/fleet/daily-stats/overview?date=YYYY-MM-DD
 *
 * Every actively tracked vehicle's row for one SAST calendar day.
 *
 * Defaults to YESTERDAY rather than today: today's fold has only seen the hours that have
 * happened, so every vehicle looks partially covered until midnight and the table reads as a
 * fleet-wide outage every morning.
 *
 * A vehicle with no row for the day comes back with `stats: null` and stays in the list. That is
 * the most interesting line in the table — an inner join would have deleted it — and the renderer
 * must show it as "no data", never as zero.
 *
 * Gated on `fleet.vehicle-stats:view` (migration 529, PR #2619 — unapplied on master today).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { loadFleetDayOverview, sastYesterday } from '@/modules/fleet/dailyStats/statsQueries';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const date = one(req.query.date as string | string[] | undefined) ?? sastYesterday();
  if (!DATE_RE.test(date)) {
    return apiResponse.badRequest(res, 'date must be YYYY-MM-DD');
  }

  const vehicles = await loadFleetDayOverview(date);

  return apiResponse.success(res, {
    workDate: date,
    vehicles,
    coverage: {
      trackedVehicles: vehicles.length,
      // Named rather than implied. "12 of 18 vehicles reported" is a different statement from
      // "the fleet drove 400 km", and a table showing only the second is misread as the first.
      vehiclesWithData: vehicles.filter((v) => v.stats !== null).length,
      vehiclesPartial: vehicles.filter((v) => v.stats !== null && !v.stats.coverageComplete).length,
    },
  });
}

async function permissionRouted(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  return withPermission('fleet.vehicle-stats', 'view')(handler)(req, res);
}

export default withAuth(permissionRouted);
