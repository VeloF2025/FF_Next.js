import { describe, it, expect } from 'vitest';
import { netstarClient } from '../client';

describe('netstarClient.fetchHistory — a non-numeric external id fails loudly', () => {
  it('does not send selectedIds: [null] to the portal', async () => {
    // JSON.stringify turns NaN into null, so the portal would have received a
    // report request for no vehicle — an empty export that reads downstream as
    // a data gap rather than as the bad id it is.
    const c = netstarClient({
      baseUrl: 'https://portal.example.com',
      username: 'u', password: 'p',
      fetchImpl: (async (input: RequestInfo | URL) => {
        if (input.toString().includes('/Authentication/Account/Login')) {
          return new Response(null, { status: 200 });
        }
        throw new Error('should never reach the portal');
      }) as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(
      c.fetchHistory(
        new Date('2026-08-01T00:00:00Z'), new Date('2026-08-02T00:00:00Z'),
        [{ externalId: 'folder-node', registration: 'Europcar Gauteng' }]
      )
    ).rejects.toThrow(/non-numeric external id "folder-node"/);
  });
});
