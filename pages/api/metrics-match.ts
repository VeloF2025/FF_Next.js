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
import { matchMetric } from '@/modules/metrics/registry/intent';

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

  const match = matchMetric(q);
  // The shape is deliberately explicit about which case occurred, so the caller
  // cannot mistake "ambiguous" for "no match" and quietly pick one.
  //
  // No permission filter here: the response carries only keys and labels, never
  // `cite` (which names internal tables and predicates). metrics-query still
  // enforces the per-metric permission before any data is returned, so a caller
  // who matches a metric they may not read gets a 403 there, not a number.
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
    },
  });
}

export default withAuth(handler);
