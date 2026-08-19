/**
 * GET /api/my/fleet/incidents — staff-scoped Fleet incident list (PR7 Task 4).
 * Session-gated via the `/my` portal cookie (`withMySession`). `session.staffId`
 * is the sole scope for the underlying read; nothing in the query string can
 * name a different staff member (design §10).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import {
  DriverIncidentValidationError, listDriverIncidents, type ListDriverIncidentsFilters,
} from '@/modules/fleet/incidents/driver/driverIncidentService';

function parseBoolean(value: unknown): boolean { return value === 'true' || value === '1'; }
function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
/** `undefined` = not supplied (caller default applies); `NaN` = supplied but not a number (caller must 400). */
function parseOptionalInt(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : NaN;
}

async function handler(req: NextApiRequest, res: NextApiResponse, session: AttendanceSession): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);

  const limit = parseOptionalInt(req.query.limit);
  const offset = parseOptionalInt(req.query.offset);
  if (limit !== undefined && Number.isNaN(limit)) return apiResponse.badRequest(res, 'limit must be a number');
  if (offset !== undefined && Number.isNaN(offset)) return apiResponse.badRequest(res, 'offset must be a number');

  // `req.query.staffId` (or any similarly named field) is intentionally
  // never read here — the list is always scoped to `session.staffId`.
  const filters: ListDriverIncidentsFilters = {
    history: parseBoolean(req.query.history),
    fromDate: parseOptionalString(req.query.fromDate),
    toDate: parseOptionalString(req.query.toDate),
    limit, offset,
  };

  try {
    const result = await listDriverIncidents(session.staffId, filters);
    return apiResponse.success(res, result);
  } catch (error) {
    if (error instanceof DriverIncidentValidationError) return apiResponse.badRequest(res, error.message);
    log.error('[my-fleet-incidents] failed to list driver incidents', {
      staffId: session.staffId, error: error instanceof Error ? error.message : String(error),
    }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

export default withMySession(handler);
