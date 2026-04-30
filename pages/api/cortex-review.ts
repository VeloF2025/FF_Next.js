import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';

const BRIDGE_URL = process.env.CORTEX_BRIDGE_URL ?? 'http://localhost:7403';
const API_KEY = process.env.CORTEX_API_KEY ?? '';

function bridgeHeaders(): Record<string, string> {
  return API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = (req as AuthenticatedNextApiRequest).user;

  if (req.method === 'GET') {
    try {
      const upstream = await fetch(`${BRIDGE_URL}/api/review?status=pending&limit=50`, {
        headers: bridgeHeaders(),
      });
      if (!upstream.ok) {
        return apiResponse.internalError(res, new Error(`Bridge ${upstream.status}`));
      }
      const data = (await upstream.json()) as unknown;
      return apiResponse.success(res, data);
    } catch (e) {
      return apiResponse.internalError(res, e instanceof Error ? e : new Error(String(e)));
    }
  }

  if (req.method === 'PATCH') {
    const { id, decision } = req.body as { id: number; decision: 'approved' | 'rejected' };
    if (!id || !decision) return apiResponse.badRequest(res, 'id and decision are required');

    try {
      const upstream = await fetch(`${BRIDGE_URL}/api/review/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...bridgeHeaders() },
        body: JSON.stringify({ decision, reviewer: user.email }),
      });
      if (!upstream.ok) {
        return apiResponse.internalError(res, new Error(`Bridge ${upstream.status}`));
      }
      return apiResponse.success(res, { ok: true });
    } catch (e) {
      return apiResponse.internalError(res, e instanceof Error ? e : new Error(String(e)));
    }
  }

  return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'PATCH']);
}

export default withAuth(handler);
