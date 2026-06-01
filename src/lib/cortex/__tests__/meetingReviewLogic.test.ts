import { describe, it, expect } from 'vitest';
import { fetchOutboxSummary } from '@/lib/cortex/meetingReviewLogic';

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
}

describe('fetchOutboxSummary', () => {
  it('returns the effective summary from /{id}/outbox', async () => {
    const summary = await fetchOutboxSummary('mtg_a', 'r@test.com', 'http://bridge:7403', 'key',
      fakeFetch({ meeting_id: 'mtg_a', summary: 'Human exec summary', items: [] }));
    expect(summary).toBe('Human exec summary');
  });

  it('returns null when the meeting is gated (summary null)', async () => {
    const summary = await fetchOutboxSummary('mtg_a', 'r@test.com', 'http://bridge:7403', 'key',
      fakeFetch({ meeting_id: 'mtg_a', gated: true, summary: null, items: [] }));
    expect(summary).toBeNull();
  });

  it('returns null on a non-OK outbox response (non-fatal)', async () => {
    const summary = await fetchOutboxSummary('mtg_a', 'r@test.com', 'http://bridge:7403', 'key',
      fakeFetch({}, false, 404));
    expect(summary).toBeNull();
  });
});
