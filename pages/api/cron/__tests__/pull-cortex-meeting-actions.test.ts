import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

// syncCortexMeetingActions is mocked (no real bridge/DB); vi.hoisted so the ref exists when
// vi.mock's factory (hoisted above the imports) runs.
const { syncMock } = vi.hoisted(() => ({ syncMock: vi.fn() }));
vi.mock('@/lib/cortex/pullMeetingActions', () => ({ syncCortexMeetingActions: syncMock }));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-neon', () => ({ neon: () => vi.fn() }));

const ORIG_ENV = { ...process.env };

// API_KEY / BRIDGE_URL are module-level consts read at import, so re-import per test.
async function loadHandler() {
  vi.resetModules();
  const mod = await import('../pull-cortex-meeting-actions');
  return mod.default as (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
}

describe('pull-cortex-meeting-actions cron handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncMock.mockResolvedValue({ pulled: 0, mapped: 0, unmapped: 0 });
    process.env = { ...ORIG_ENV, DATABASE_URL: 'postgres://x' };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('rejects a non-POST method with 405', async () => {
    process.env.CRON_SECRET = 's';
    process.env.CORTEX_API_KEY = 'k';
    const handler = await loadHandler();
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(405);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    process.env.CORTEX_API_KEY = 'k';
    const handler = await loadHandler();
    const { req, res } = createMocks({ method: 'POST' });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(500);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 401 on a wrong bearer token', async () => {
    process.env.CRON_SECRET = 'secret';
    process.env.CORTEX_API_KEY = 'k';
    const handler = await loadHandler();
    const { req, res } = createMocks({ method: 'POST', headers: { authorization: 'Bearer wrong' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(401);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 500 when CORTEX_API_KEY is not configured', async () => {
    process.env.CRON_SECRET = 'secret';
    delete process.env.CORTEX_API_KEY;
    const handler = await loadHandler();
    const { req, res } = createMocks({ method: 'POST', headers: { authorization: 'Bearer secret' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(500);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('returns 202 and triggers the sync on valid auth', async () => {
    process.env.CRON_SECRET = 'secret';
    process.env.CORTEX_API_KEY = 'k';
    const handler = await loadHandler();
    const { req, res } = createMocks({ method: 'POST', headers: { authorization: 'Bearer secret' } });
    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(202);
    // The sync runs in the handler's setImmediate. Our own setImmediate is queued AFTER it
    // (FIFO), so awaiting this resolves only once the handler's callback has started and
    // synchronously invoked syncMock (the mock resolves immediately — see beforeEach).
    await new Promise((resolve) => setImmediate(resolve));
    expect(syncMock).toHaveBeenCalledOnce();
  });
});
