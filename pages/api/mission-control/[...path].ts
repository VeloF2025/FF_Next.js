import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';

const MC_BASE = 'http://127.0.0.1:3847/api';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = (req as AuthenticatedNextApiRequest).user;

  if (user.role !== 'super_admin' && user.role !== 'system') {
    return res.status(403).json({ error: 'Forbidden: SUPER_ADMIN required' });
  }

  const { path } = req.query;
  const pathSegments = Array.isArray(path) ? path.join('/') : path || '';

  // Build query string
  const url = new URL(`${MC_BASE}/${pathSegments}`);
  const queryParams = { ...req.query };
  delete queryParams.path;
  Object.entries(queryParams).forEach(([k, v]) => {
    if (v !== undefined) url.searchParams.set(k, String(v));
  });

  try {
    const fetchOptions: RequestInit = {
      method: req.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(url.toString(), fetchOptions);
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    log.error('mission-control-[...path]', { error: error instanceof Error ? error.message : String(error) });
    return res.status(502).json({ error: 'Mission Control server unavailable' });
  }
}

export default withAuth(handler);
