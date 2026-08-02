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
import { log } from '@/lib/logger';
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
  let visible: (typeof METRICS)[number][];
  try {
    const checked = await Promise.all(
      METRICS.map(async (m) =>
        isSuperAdmin || (await userHasPermission(userId, m.permission, 'view')) ? m : null,
      ),
    );
    visible = checked.filter((m): m is (typeof METRICS)[number] => m !== null);
  } catch (error) {
    // The RBAC lookup is a database call. Without this it rejects past the
    // handler into the framework, which answers with an unstructured 500 and no
    // log line — withAuth returns the handler promise rather than awaiting it,
    // so its own catch never sees this.
    log.error('Metric list permission check failed', { error });
    return apiResponse.internalError(res, error, 'Permission check failed');
  }

  return apiResponse.success(
    res,
    visible
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
