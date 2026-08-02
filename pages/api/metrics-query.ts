/**
 * GET /api/metrics-query?key=..&from=YYYY-MM-DD&to=YYYY-MM-DD&grain=day&dimensions=project,pop
 *
 * ⚠️ MUST BE GET. MCP tokens are restricted to GET/HEAD/OPTIONS by
 * `src/lib/auth/readOnly.ts`, enforced inside withAuth. A POST route is
 * unreachable by Cortex no matter how it authenticates. Do not "modernise" this
 * to POST for a cleaner body — it would silently break the only consumer.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { userHasPermission } from '@/lib/permissions';
import { findMetric } from '@/modules/metrics/registry';
import { executeMetric } from '@/modules/metrics/registry/execute';
import { validateMetricQuery } from '@/modules/metrics/registry/queryBuilder';

// Year 0000 is rejected: it satisfies the JS Date round-trip but PostgreSQL has no
// year zero and errors at parse time, which would surface as a 500 rather than a 400.
const ISO_DATE = /^(?!0000)\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

const PARAMS = ['key', 'from', 'to', 'grain', 'dimensions'] as const;

/** A real calendar date, not just the right shape — rejects 2026-02-31. */
function isValidDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    // Signature is (res, method, allowedMethods) — three args.
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  // A repeated param (`?key=a&key=b`) arrives as an array and is REJECTED rather
  // than silently resolved to the first value — a caller sending two values has a
  // bug, and picking one hides it.
  const duplicated = PARAMS.find((name) => Array.isArray(req.query[name]));
  if (duplicated) {
    return apiResponse.badRequest(res, `duplicate query parameter: ${duplicated}`);
  }

  const key = req.query.key as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const grain = req.query.grain as string | undefined;
  const rawDims = (req.query.dimensions as string | undefined) ?? '';

  if (!key || !from || !to || !grain) {
    return apiResponse.badRequest(res, 'key, from, to and grain are required');
  }
  if (!isValidDate(from) || !isValidDate(to)) {
    return apiResponse.badRequest(res, 'from and to must be valid YYYY-MM-DD dates');
  }
  if (from > to) {
    return apiResponse.badRequest(res, `from (${from}) must not be after to (${to})`);
  }
  // The range is INCLUSIVE of both ends, so a from==to request spans 1 day.
  // Comparing the raw difference would allow MAX_RANGE_DAYS + 1 calendar days.
  const spanDays =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    return apiResponse.badRequest(
      res,
      `range of ${spanDays} days exceeds the ${MAX_RANGE_DAYS}-day maximum`,
    );
  }

  // Comma-separated, trimmed, de-duplicated, order preserved. An empty token
  // (`dimensions=project,,pop`) is a caller bug, so reject rather than normalise.
  const dimTokens = rawDims ? rawDims.split(',').map((d) => d.trim()) : [];
  if (dimTokens.some((d) => d === '')) {
    return apiResponse.badRequest(res, 'dimensions must not contain empty values');
  }
  const dimensions = [...new Set(dimTokens)];

  const def = findMetric(key);
  if (!def) return apiResponse.notFound(res, 'Metric', key);

  // Reject a grain or dimension the metric does not support BEFORE the RBAC
  // round-trip: request validation is pure and cheap, authorisation costs a
  // database query. executeMetric re-validates, so this is not the only guard.
  const metricQuery = { from, to, grain: grain as never, dimensions };
  try {
    validateMetricQuery(def, metricQuery);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'bad query';
    // Worth a line: the only callers are machine clients, so a rejected request
    // means a consumer is sending a grain or dimension the registry never offered.
    log.warn('Metric query rejected', { key, grain, dimensions, message });
    return apiResponse.badRequest(res, message);
  }

  // Permission is per-metric, so it can only be checked once the key resolves —
  // which is why this is a runtime check rather than the repo's usual static
  // `withPermission('x','view')(handler)` composition.
  const authReq = req as AuthenticatedNextApiRequest;
  const userId = authReq.user?.id;
  // Explicit null check FIRST — see metrics-list for why optional chaining alone
  // fails open here.
  if (!userId) return apiResponse.unauthorized(res, 'Authentication required');
  const allowed =
    authReq.user.role === 'super_admin' ||
    (await userHasPermission(userId, def.permission, 'view'));
  if (!allowed) return apiResponse.forbidden(res, `Permission required: ${def.permission}`);

  try {
    const result = await executeMetric(def, metricQuery);
    return apiResponse.success(res, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Validation errors are the caller's fault; anything else is ours.
    if (/unsupported (grain|dimension)/i.test(message)) {
      return apiResponse.badRequest(res, message);
    }
    log.error('Metric query failed', { key, error });
    return apiResponse.internalError(res, error, 'Metric execution failed');
  }
}

export default withAuth(handler);
