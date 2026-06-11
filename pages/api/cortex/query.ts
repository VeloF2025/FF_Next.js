/**
 * Cortex cited-knowledge search proxy.
 *
 *   GET /api/cortex/query?q=…&limit=…  → { citations: Citation[] }
 *
 * Forwards to the bridge `GET /api/query?include_citations=true` carrying a
 * PER-USER gateway JWT minted from the server-verified FibreFlow user
 * (bridgeBearer). The bridge therefore applies THIS user's channel-membership ACL
 * beneath the tenant gate: a channel-scoped reviewer sees only their channels and
 * derived synthesis/dream insights are suppressed for them, while a super-admin
 * (CORTEX_SUPER_ADMIN_EMAILS) sees the full set. The proxy performs NO access
 * control of its own and never trusts a client-supplied identity — req.user.email
 * (already verified by withAuth) is the only asserted principal, and the api key
 * (dark fallback) stays server-side.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withPermission } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { bridgeBearer } from '@/lib/cortex/bridgeAuth';
import { fetchWithTimeout } from '@/lib/cortex/meetingReviewLogic';

const BRIDGE_URL = process.env.CORTEX_BRIDGE_URL ?? 'http://localhost:7403';

// Mirrors the bridge envelope (apps/bridge/routes/query.py :: Citation). Fields
// after source_id are always serialised by the bridge but can be empty.
export interface Citation {
  n: number;
  source: string;
  source_id: string;
  channel?: string;
  author?: string;
  timestamp?: string;
  score?: number;
  snippet?: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const MAX_Q_LEN = 500;

/** Clamp a raw ?limit value to [1, MAX_LIMIT], defaulting on garbage. */
export function clampLimit(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

async function getHandler(req: AuthenticatedNextApiRequest, res: NextApiResponse): Promise<void> {
  const user = req.user;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return apiResponse.badRequest(res, 'q is required');
  if (q.length > MAX_Q_LEN) return apiResponse.badRequest(res, `q exceeds ${MAX_Q_LEN} characters`);

  const limit = clampLimit(req.query.limit);

  // Per-user gateway JWT — the bridge narrows the ACL to this reviewer.
  const bearer = await bridgeBearer(user.email);
  const params = new URLSearchParams({ q, include_citations: 'true', limit: String(limit) });

  const upstream = await fetchWithTimeout(fetch, `${BRIDGE_URL}/api/query?${params}`, {
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      'X-Cortex-Reviewer': user.email,
    },
  });
  if (!upstream.ok) {
    // Upstream non-OK is not a proxy crash — warn with context, surface as 5xx.
    log.warn('Cortex query upstream non-OK', { status: upstream.status }, 'cortex-query');
    return apiResponse.internalError(res, new Error(`Bridge ${upstream.status}`));
  }
  const data = (await upstream.json()) as { citations?: Citation[] };
  return apiResponse.success(res, {
    citations: Array.isArray(data.citations) ? data.citations : [],
  });
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }
  const authReq = req as AuthenticatedNextApiRequest;
  // Reviewer gate at the FF layer (consistent with the other Cortex routes);
  // the bridge then applies this user's per-channel ACL beneath it.
  return withPermission('cortex.review', 'view')(
    async (r, s) => {
      try {
        await getHandler(r as AuthenticatedNextApiRequest, s);
      } catch (err) {
        // Single error log — apiResponse.internalError does NOT log, so this is
        // the one place the failure is recorded (with context).
        log.error('cortex-query error', { error: err }, 'cortex-query');
        apiResponse.internalError(s, err instanceof Error ? err : new Error(String(err)));
      }
    },
  )(authReq, res);
}

export default withAuth(handler);
