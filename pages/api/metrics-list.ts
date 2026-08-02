/**
 * GET /api/metrics-list — the metric catalogue.
 *
 * GET-only and authenticated. The catalogue enumerates internal table names and
 * predicates in `cite`, which is operational detail — it does not belong on an
 * anonymous endpoint. GET-only both matches the MCP restriction
 * (`src/lib/auth/readOnly.ts` allows GET/HEAD/OPTIONS only) and stops the route
 * answering to verbs it has no handler for.
 *
 * Entries are filtered by the caller's permission: authentication is not
 * authorisation, and a metric the caller may not query must not be advertised.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { userHasPermission } from '@/lib/permissions';
import { METRICS } from '@/modules/metrics/registry';

export async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const userId = authReq.user?.id;
  // Explicit null check FIRST. An optional-chained role comparison evaluates
  // false on a null user, which reads as "not super admin" and falls through to
  // the permission call with an undefined id — failing open is the exact shape
  // this guard exists to prevent.
  if (!userId) return apiResponse.unauthorized(res, 'Authentication required');

  const isSuperAdmin = authReq.user.role === 'super_admin';
  const visible = await Promise.all(
    METRICS.map(async (m) =>
      isSuperAdmin || (await userHasPermission(userId, m.permission, 'view')) ? m : null,
    ),
  );

  return apiResponse.success(
    res,
    visible
      .filter((m): m is (typeof METRICS)[number] => m !== null)
      .map((m) => ({
        key: m.key,
        label: m.label,
        description: m.description,
        grains: m.grains,
        dimensions: m.dimensions,
        aliases: m.aliases,
        // Consumers must know this to interpret `total` — for a semi-additive
        // metric it is the latest period's value, not a sum of the series.
        additivity: m.additivity,
        source: m.cite,
      })),
  );
}

export default withAuth(handler);
