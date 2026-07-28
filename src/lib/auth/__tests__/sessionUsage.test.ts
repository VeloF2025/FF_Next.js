import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above every top-level statement, so the spy they close
// over must be created inside vi.hoisted.
const { query, log } = vi.hoisted(() => ({
  query: vi.fn(),
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ db: { query } }));
vi.mock('@/lib/logger', () => ({ log }));

import { touchSessionUsage } from '../sessionUsage';

describe('touchSessionUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockResolvedValue({ rows: [] });
  });

  it('does nothing for browser sessions', () => {
    touchSessionUsage('s1', 'browser');
    expect(query).not.toHaveBeenCalled();
  });

  it('issues a throttled update for mcp sessions', () => {
    touchSessionUsage('s1', 'mcp');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toContain('last_used_at');
    expect(query.mock.calls[0]![0]).toContain('INTERVAL');
    expect(query.mock.calls[0]![1]).toEqual(['s1']);
  });

  it('never throws and leaves no unhandled rejection when the database fails', async () => {
    query.mockRejectedValue(new Error('db down'));
    expect(() => touchSessionUsage('s1', 'mcp')).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('reports a failed update at a level production actually emits', async () => {
    // The logger only writes info/debug to stdout when LOG_STDOUT=true, so a debug line
    // here would be invisible in production — and this write is best-effort, which is
    // precisely the excuse under which a permanently-failing update goes unnoticed. The
    // logger's own comment records a 2026-07-10 outage that stayed hidden for three days
    // for the same reason.
    query.mockRejectedValue(new Error('db down'));

    touchSessionUsage('s1', 'mcp');
    await new Promise((r) => setTimeout(r, 0));

    expect(log.warn, 'a failed last_used_at write must be visible in prod').toHaveBeenCalledTimes(1);
    expect(log.debug).not.toHaveBeenCalled();
    expect(log.warn.mock.calls[0]![1]).toMatchObject({ sessionId: 's1' });
  });
});
