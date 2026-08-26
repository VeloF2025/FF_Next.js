/**
 * GET /api/fleet/vehicles/[id]/daily-stats?days=30&endDate=YYYY-MM-DD
 *
 * One vehicle's stored vehicle-day rows over a SAST window, plus the two numbers a reader needs
 * to know how much of that window was ever observable.
 *
 * The window is SAST, and that is the whole point of computing it here rather than in the browser
 * or in SQL's `CURRENT_DATE`: the host may run in UTC, in which case every instant between 22:00
 * and midnight SAST belongs to the NEXT work date, and a UTC window is a day short at one end.
 *
 * It ends on YESTERDAY by default, and today is returned separately as `today`. Today's fold has
 * only seen the hours that have happened, so a day still in progress is `coverage_complete = false`
 * for reasons that say nothing about the tracker — folding it into the window would leave a
 * perfectly healthy vehicle showing a partial day and a short coverage ratio every morning until
 * midnight. It is still shown, on its own line, labelled as in progress.
 *
 * `days` returns only the rows that EXIST. A date missing from the response was never observed;
 * the renderer has a distinct state for it, and this route must not invent a row of zeros to fill
 * the hole — see migration 528's column comments, where a missing row and a still day are
 * deliberately different things.
 *
 * Gated on `fleet.vehicle-stats:view`, seeded by migration 529 (PR #2619). Until 529 is applied
 * no role holds the key and only super_admin (which bypasses RBAC) can reach this route.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import {
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  daysBetweenInclusive,
  loadFirstPositionWorkDate,
  loadVehicleDayStats,
  loadVehicleIdentity,
  sastToday,
  sastYesterday,
  statsWindow,
} from '@/modules/fleet/dailyStats/statsQueries';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const vehicleId = one(req.query.id as string | string[] | undefined);
  if (!vehicleId || !UUID_RE.test(vehicleId)) {
    return apiResponse.badRequest(res, 'vehicle id must be a UUID');
  }

  const endDate = one(req.query.endDate as string | string[] | undefined) ?? sastYesterday();
  if (!DATE_RE.test(endDate)) {
    return apiResponse.badRequest(res, 'endDate must be YYYY-MM-DD');
  }

  const rawDays = one(req.query.days as string | string[] | undefined);
  const requestedDays = rawDays === undefined ? DEFAULT_WINDOW_DAYS : Number(rawDays);
  if (!Number.isFinite(requestedDays) || requestedDays < 1) {
    return apiResponse.badRequest(res, `days must be a number between 1 and ${MAX_WINDOW_DAYS}`);
  }

  const vehicle = await loadVehicleIdentity(vehicleId);
  if (!vehicle) {
    return apiResponse.notFound(res, 'Vehicle', vehicleId);
  }

  // Clamped rather than refused: a caller asking for a year gets the longest honest answer this
  // route serves, and `window.days` tells it what it actually got.
  const window = statsWindow(endDate, requestedDays);
  // The in-progress line exists only for a window that runs up to yesterday — the default. An
  // explicit `endDate` further back asks a historical question, and pinning today's partial row
  // to the bottom of a June window would be an answer to a question nobody asked.
  const todayWorkDate = sastToday();
  const wantsToday = window.endWorkDate === sastYesterday();
  const [days, firstPositionWorkDate, todayRows] = await Promise.all([
    loadVehicleDayStats(vehicleId, window),
    loadFirstPositionWorkDate(vehicleId),
    wantsToday
      ? loadVehicleDayStats(vehicleId, statsWindow(todayWorkDate, 1))
      : Promise.resolve(null),
  ]);

  // Days EXPECTED, not days elapsed. A tracker fitted last week has not missed the three weeks
  // before it existed, and counting those would report a healthy feed as broken.
  const observableFrom = firstPositionWorkDate !== null && firstPositionWorkDate > window.startWorkDate
    ? firstPositionWorkDate
    : window.startWorkDate;
  const daysExpected = firstPositionWorkDate === null || firstPositionWorkDate > window.endWorkDate
    ? 0
    : daysBetweenInclusive(observableFrom, window.endWorkDate);

  return apiResponse.success(res, {
    vehicle,
    window,
    days,
    // Never folded into `days` or into any coverage number below: a day that is still running is
    // not a day that was poorly observed.
    today: todayRows === null
      ? null
      : { workDate: todayWorkDate, stats: todayRows[0] ?? null },
    coverage: {
      firstPositionWorkDate,
      daysWithData: days.length,
      daysExpected,
      // Counted separately: a day that was built but could not be observed to the feed's own
      // standard is neither "with data" in the useful sense nor missing.
      daysPartial: days.filter((d) => !d.coverageComplete).length,
    },
  });
}

async function permissionRouted(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  return withPermission('fleet.vehicle-stats', 'view')(handler)(req, res);
}

export default withAuth(permissionRouted);
