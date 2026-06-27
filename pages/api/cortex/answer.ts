/**
 * Cortex grounded-answer proxy.
 *
 *   POST /api/cortex/answer  { question, limit? }  → { answer, confidence, … }
 *
 * Forwards to the bridge `POST /api/answer` carrying a PER-USER gateway JWT minted
 * from the server-verified FibreFlow user (bridgeBearer) — the SAME per-user ACL path
 * as /api/cortex/query. Unlike that raw-retrieval proxy, /api/answer returns a
 * GROUNDED, cite-or-abstain answer plus deterministic gaps and a confidence level.
 * The proxy performs NO access control of its own and never trusts a client-supplied
 * identity — req.user.email (verified by withAuth) is the only asserted principal, and
 * the api key (dark fallback) stays server-side. The bridge applies this user's
 * channel-membership ACL beneath the tenant gate.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withPermission } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { bridgeBearer } from '@/lib/cortex/bridgeAuth';
import { getForwardableEntraIdToken } from '@/lib/cortex/entraAuth';
import { fetchWithTimeout } from '@/lib/cortex/meetingReviewLogic';
import { clampLimit, type Citation } from '@/lib/cortex/queryHelpers';
import type { AnswerGap } from '@/lib/cortex/answerFormat';

const BRIDGE_URL = process.env.CORTEX_BRIDGE_URL ?? 'http://localhost:7403';
const MAX_Q_LEN = 500;

// Mirrors the bridge envelope (apps/bridge/routes/answer.py :: AnswerResponse). Only
// the fields this surface renders are modelled; the bridge serialises more.
export interface AnswerEnvelope {
  answer: string;
  confidence: string;
  confidence_reason: string;
  citations: Citation[];
  gaps: AnswerGap[];
}

async function postHandler(req: AuthenticatedNextApiRequest, res: NextApiResponse): Promise<void> {
  const user = req.user;
  const body = (req.body ?? {}) as { question?: unknown; limit?: unknown };
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) return apiResponse.badRequest(res, 'question is required');
  if (question.length > MAX_Q_LEN) {
    return apiResponse.badRequest(res, `question exceeds ${MAX_Q_LEN} characters`);
  }

  const limit = clampLimit(body.limit);

  // Per-user identity for the bridge ACL — identical to /api/cortex/query: forward the
  // user's real Entra OIDC token when its subject matches this FF session, else the
  // HS256 gateway JWT / api key. Bound to user.email; read only from the httpOnly cookie.
  const entraIdToken = getForwardableEntraIdToken(req.cookies, user.email);
  const bearer = await bridgeBearer(user.email, { entraIdToken });

  const upstream = await fetchWithTimeout(fetch, `${BRIDGE_URL}/api/answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      'X-Cortex-Reviewer': user.email,
    },
    body: JSON.stringify({ question, limit }),
  });
  if (!upstream.ok) {
    // Upstream non-OK is not a proxy crash; log once at warn and surface as a 5xx.
    // apiResponse.error does NOT log (unlike internalError), so this is the single record.
    log.warn('Cortex answer upstream non-OK', { status: upstream.status }, 'cortex-answer');
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'An internal error occurred');
  }
  const data = (await upstream.json()) as Partial<AnswerEnvelope>;
  return apiResponse.success(res, {
    answer: typeof data.answer === 'string' ? data.answer : '',
    confidence: typeof data.confidence === 'string' ? data.confidence : '',
    confidence_reason: typeof data.confidence_reason === 'string' ? data.confidence_reason : '',
    citations: Array.isArray(data.citations) ? data.citations : [],
    gaps: Array.isArray(data.gaps) ? data.gaps : [],
  });
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }
  const authReq = req as AuthenticatedNextApiRequest;
  // Reviewer gate at the FF layer (consistent with the other Cortex routes); the bridge
  // then applies this user's per-channel ACL beneath it.
  return withPermission('cortex.review', 'view')(
    async (r, s) => {
      try {
        await postHandler(r as AuthenticatedNextApiRequest, s);
      } catch (err) {
        // apiResponse.error does NOT log (unlike internalError), so this explicit, tagged
        // log is the single record of the failure; details are withheld from the response.
        log.error('cortex-answer error', { error: err }, 'cortex-answer');
        apiResponse.error(s, ErrorCode.INTERNAL_ERROR, 'An internal error occurred');
      }
    },
  )(authReq, res);
}

export default withAuth(handler);
