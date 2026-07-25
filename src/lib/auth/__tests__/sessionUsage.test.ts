import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above every top-level statement, so the spy they close
// over must be created inside vi.hoisted.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query } }));

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
});
