/**
 * GET /api/metrics-match?q=how+many+open+pre-provisions
 *
 * Without this endpoint `matchMetric` is dead code: it is TypeScript inside
 * FibreFlow, Cortex is a separate Python process, and metrics-list/metrics-query
 * only expose *query by key*. Nothing could reach the matcher, its unit test
 * would prove only that local dead code works, and Cortex would have no way to
 * return candidates for an ambiguous question — the whole point of building it.
 *
 * Exposing it here rather than reimplementing the matcher in Python keeps the
 * aliases in exactly one place: the registry. Cortex stays a thin client.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { userHasPermission } from '@/lib/permissions';
import { METRICS } from '@/modules/metrics/registry';
import { matchMetric } from '@/modules/metrics/registry/intent';
import type { MetricDefinition } from '@/modules/metrics/registry/types';

export async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  // Rejected rather than resolved to the first value: a caller sending two
  // questions has a bug, and answering one of them hides it.
  if (Array.isArray(req.query.q)) {
    return apiResponse.badRequest(res, 'duplicate query parameter: q');
  }
  const q = req.query.q as string | undefined;
  if (typeof q !== 'string' || !q.trim()) {
    return apiResponse.badRequest(res, 'q is required');
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const userId = authReq.user?.id;
  // Explicit null check FIRST — an optional-chained role comparison evaluates
  // false on a null user and reads as "not super admin" rather than "deny".
  if (!userId) return apiResponse.unauthorized(res, 'Authentication required');

  // Match only over metrics this caller may actually read. Matching the full
  // registry and filtering afterwards would still advertise a hidden metric's
  // existence — and letting a hidden metric win the alias contest would turn a
  // question the caller IS allowed to have answered into a dead end.
  let visible: MetricDefinition[];
  try {
    const isSuperAdmin = authReq.user.role === 'super_admin';
    const checked = await Promise.all(
      METRICS.map(async (m) =>
        isSuperAdmin || (await userHasPermission(userId, m.permission, 'view')) ? m : null,
      ),
    );
    visible = checked.filter((m): m is MetricDefinition => m !== null);
  } catch (error) {
    // The RBAC lookup is a database call. Without this it rejects past the
    // handler into the framework, which answers with an unstructured 500 and no
    // log line — withAuth returns the handler promise rather than awaiting it,
    // so its own catch never sees this.
    log.error('Metric match permission check failed', { error });
    return apiResponse.internalError(res, error, 'Permission check failed');
  }

  const match = matchMetric(q, visible);
  // The shape is deliberately explicit about which case occurred, so the caller
  // cannot mistake "ambiguous" for "no match" and quietly pick one.
  if (match.kind === 'none') return apiResponse.success(res, { kind: 'none' });
  if (match.kind === 'ambiguous') {
    return apiResponse.success(res, {
      kind: 'ambiguous',
      candidates: match.candidates.map((m) => ({
        key: m.key,
        label: m.label,
        description: m.description,
      })),
    });
  }
  return apiResponse.success(res, {
    kind: 'exact',
    metric: {
      key: match.metric.key,
      label: match.metric.label,
      grains: match.metric.grains,
      dimensions: match.metric.dimensions,
      // Returned so a client can choose its date window BEFORE spending a query.
      // A semi-additive measure is a level — the useful default is "as at the latest
      // observation", which needs a lookback window sized to the metric's cadence.
      // An additive measure is an event count with no "as at": its value IS the window,
      // so a client must state the period it chose rather than imply a point in time.
      // Without this field a client cannot tell the two apart until after it queries,
      // and would have to guess the window it already committed to.
      additivity: match.metric.additivity,
    },
  });
}

export default withAuth(handler);
