import { describe, it, expect } from 'vitest';
import { chunkWindow, MAX_REPORT_MS, netstarClient } from '../client';

/**
 * Builds a fetchImpl that answers the login POST with a bare 200 (so
 * PortalSession considers the session established) and answers
 * GetReportTree with the given body, serialised as JSON.
 */
function fakeFetch(reportTreeBody: unknown, reportTreeStatus = 200) {
  return async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = input.toString();
    if (url.includes('/Authentication/Account/Login')) {
      return new Response(null, { status: 200 });
    }
    if (url.includes('/Reports/ReportRepo/GetReportTree')) {
      return new Response(JSON.stringify(reportTreeBody), {
        status: reportTreeStatus,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`fakeFetch: unexpected url ${url}`);
  };
}

describe('chunkWindow', () => {
  it('returns a single chunk when inside the limit', () => {
    const from = new Date('2026-08-01T00:00:00Z');
    const to = new Date('2026-08-05T00:00:00Z');
    expect(chunkWindow(from, to, MAX_REPORT_MS)).toEqual([{ from, to }]);
  });

  it('splits a 90-day window into chunks no wider than the limit', () => {
    const from = new Date('2026-05-01T00:00:00Z');
    const to = new Date('2026-07-30T00:00:00Z');
    const chunks = chunkWindow(from, to, MAX_REPORT_MS);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.to.getTime() - c.from.getTime()).toBeLessThanOrEqual(MAX_REPORT_MS);
    }
  });

  it('covers the window with no gaps', () => {
    const from = new Date('2026-05-01T00:00:00Z');
    const to = new Date('2026-07-30T00:00:00Z');
    const chunks = chunkWindow(from, to, MAX_REPORT_MS);
    expect(chunks[0].from).toEqual(from);
    expect(chunks[chunks.length - 1].to).toEqual(to);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].from.getTime()).toBe(chunks[i - 1].to.getTime());
    }
  });

  it('returns nothing for an inverted window', () => {
    expect(chunkWindow(new Date('2026-08-05'), new Date('2026-08-01'), MAX_REPORT_MS)).toEqual([]);
  });

  it('caps at 31 days, matching the portal limit', () => {
    expect(MAX_REPORT_MS).toBe(31 * 24 * 60 * 60 * 1000);
  });
});

describe('netstarClient listVehicles', () => {
  it('maps a well-formed array response', async () => {
    const client = netstarClient({
      baseUrl: 'https://x.test',
      username: 'u',
      password: 'p',
      fetchImpl: fakeFetch([
        { id: 123, name: 'ABC123' },
        { id: '456', name: 'XYZ789' },
      ]),
    });
    expect(await client.listVehicles()).toEqual([
      { externalId: '123', registration: 'ABC123' },
      { externalId: '456', registration: 'XYZ789' },
    ]);
  });

  it('throws when the response body is not an array', async () => {
    const client = netstarClient({
      baseUrl: 'https://x.test',
      username: 'u',
      password: 'p',
      fetchImpl: fakeFetch({ error: 'not a list' }),
    });
    await expect(client.listVehicles()).rejects.toThrow(
      '[netstar] vehicle list: expected an array, got object'
    );
  });

  it('skips a malformed element and keeps the well-formed ones', async () => {
    const client = netstarClient({
      baseUrl: 'https://x.test',
      username: 'u',
      password: 'p',
      fetchImpl: fakeFetch([
        { id: 1, name: 'A' },
        { name: 'no id field' },
        { id: 2 },
      ]),
    });
    expect(await client.listVehicles()).toEqual([
      { externalId: '1', registration: 'A' },
      { externalId: '2', registration: null },
    ]);
  });
});
