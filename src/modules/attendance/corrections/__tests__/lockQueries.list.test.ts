import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));

import { listLocks } from '../lockQueries';

beforeEach(() => vi.clearAllMocks());

it('requests the complete latest immutable audit record for each weekly lock', async () => {
  mocks.sql.mockResolvedValueOnce([]);
  await listLocks(50);
  const call = mocks.sql.mock.calls[0] as [readonly string[], ...unknown[]];
  const query = call[0].join(' ');

  expect(query).toMatch(/history\.actor_user_id\s+AS\s+latest_actor_user_id/i);
  expect(query).toMatch(/history\.reason\s+AS\s+latest_reason/i);
  expect(query).toMatch(/history\.recorded_at\s+AS\s+latest_recorded_at/i);
  expect(query).toMatch(/SELECT\s+lock_version,\s*action,\s*actor_user_id,\s*reason,\s*recorded_at::text/i);
});
