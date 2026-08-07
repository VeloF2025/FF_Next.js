import { describe, it, expect } from 'vitest';
import { chunkWindow, MAX_REPORT_MS, netstarClient } from '../client';

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

/**
 * The tree endpoint, exactly as the live portal serves it.
 *
 * The shipped client called POST /Reports/ReportRepo/GetReportTree and expected
 * a bare array. That path 404s — it never worked against the real portal — so
 * these fixtures are built from a capture of the running app instead.
 */
const LOGIN_PAGE = '<html><form action="/VigilCloud4/Authentication/" method="post">'
  + '<input name="__RequestVerificationToken" type="hidden" value="TOKEN-abc123" />'
  + '<input name="UserName" /><input name="Password" type="password" /></form></html>';

function treeFetch(body: unknown, status = 200, loginPage: string = LOGIN_PAGE) {
  const seen: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const logins: Array<{ url: string; body: string }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    // GET the form, then POST to /Authentication/ — two different paths.
    if (url.endsWith('/Authentication/Account/Login')) {
      return new Response(loginPage, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    if (url.endsWith('/Authentication/')) {
      logins.push({ url, body: String(init?.body ?? '') });
      return new Response(null, { status: 302, headers: { location: '/VigilCloud4/Main' } });
    }
    if (url.includes('/Main/VehicleRepo/GetVehicleTreeDataPaging')) {
      seen.push(`${(init?.method || 'GET')} ${url}`);
      headers.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`treeFetch: unexpected url ${url}`);
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, seen, headers, logins };
}

const LEAF = (leafId: number, name: string, over: Record<string, unknown> = {}) => ({
  LeafId: leafId, Name: name, GroupName: 'Ungrouped',
  Lat: -26.1, Long: 28.3, DateTimeUtc: '/Date(1786039740000)/',
  SpeedValue: 0, Dir: 158, IgnitionOn: false, ...over,
});

describe('netstarClient listVehicles', () => {
  function build(body: unknown, status = 200) {
    const t = treeFetch(body, status);
    return { ...t, client: netstarClient({
      baseUrl: 'https://x.test', username: 'u', password: 'p',
      fetchImpl: t.fetchImpl, sleep: async () => {},
    }) };
  }

  it('maps vehicle leaves to externalId + registration', async () => {
    const { client } = build({ data: [LEAF(123, 'ABC123GP'), LEAF(456, 'XYZ789GP')] });
    expect(await client.listVehicles()).toEqual([
      { externalId: '123', registration: 'ABC123GP', groupName: 'Ungrouped' },
      { externalId: '456', registration: 'XYZ789GP', groupName: 'Ungrouped' },
    ]);
  });

  // POST, not GET: the identical path answers 404 to a GET, and the portal
  // routes on X-Requested-With. Getting either wrong is a silent empty account.
  // Both halves of this are load-bearing against the real portal: the same
  // path answers 404 to a GET, and 404s again without the XHR header. Asserting
  // only the method would let the header be deleted with every test still green.
  it('POSTs, with the XHR header the portal routes on', async () => {
    const { client, seen, headers } = build({ data: [LEAF(1, 'A')] });
    await client.listVehicles();
    expect(seen[0]).toMatch(/^POST /);
    expect(seen[0]).toContain('pageSize=2147483647');
    expect(seen[0]).toMatch(/__ts=\d+/);
    expect(headers[0]).toMatchObject({ 'X-Requested-With': 'XMLHttpRequest' });
  });

  it('returns an empty list for an empty account without throwing', async () => {
    const { client } = build({ data: [] });
    expect(await client.listVehicles()).toEqual([]);
  });

  it('reports a null registration when the leaf carries no Name', async () => {
    const { client } = build({ data: [LEAF(5, 'X', { Name: undefined })] });
    expect(await client.listVehicles()).toEqual([
      { externalId: '5', registration: null, groupName: 'Ungrouped' },
    ]);
  });

  it('excludes folder nodes, which are other clients on the reseller tree', async () => {
    const { client } = build({ data: [
      { LeafId: 0, Name: 'Clients', GroupName: 'Clients' },
      LEAF(7, 'REAL01GP'),
    ] });
    expect(await client.listVehicles()).toEqual([
      { externalId: '7', registration: 'REAL01GP', groupName: 'Ungrouped' },
    ]);
  });

  it('throws on a non-JSON-envelope body rather than reporting an empty account', async () => {
    const { client } = build([LEAF(1, 'A')]);
    await expect(client.listVehicles()).rejects.toThrow(/no `data` envelope/);
  });

  it('throws on a non-200', async () => {
    const { client } = build({ data: [] }, 500);
    await expect(client.listVehicles()).rejects.toThrow('[netstar] vehicle tree: HTTP 500');
  });
});

describe('netstarClient fetchPositions (tree snapshot)', () => {
  function build(body: unknown) {
    const t = treeFetch(body);
    return netstarClient({
      baseUrl: 'https://x.test', username: 'u', password: 'p',
      fetchImpl: t.fetchImpl, sleep: async () => {},
    });
  }
  const FIX_AT = new Date('2026-08-06T18:09:00.000Z');
  const before = new Date(FIX_AT.getTime() - 3600_000);
  const after = new Date(FIX_AT.getTime() + 3600_000);

  it('returns the last fix for the requested vehicles only', async () => {
    const client = build({ data: [LEAF(1, 'A'), LEAF(2, 'B')] });
    const out = await client.fetchPositions(before, after, [{ externalId: '1', registration: 'A' }]);
    expect(out.map((p) => p.externalId)).toEqual(['1']);
    expect(out[0]!.recordedAt.toISOString()).toBe(FIX_AT.toISOString());
  });

  // The window filters the snapshot rather than fetching history. A fix older
  // than `from` was already stored on an earlier tick; re-returning it only
  // churns the dedup key.
  it('drops a fix that predates the window', async () => {
    const client = build({ data: [LEAF(1, 'A')] });
    const out = await client.fetchPositions(after, new Date(after.getTime() + 1000), [
      { externalId: '1', registration: 'A' },
    ]);
    expect(out).toEqual([]);
  });

  // Inclusive at both ends. An off-by-one here silently drops a vehicle's only
  // fix for the tick, or double-counts it against the dedup key.
  it('includes a fix exactly at `from` and exactly at `to`', async () => {
    const client = build({ data: [LEAF(1, 'A')] });
    const atFrom = await client.fetchPositions(FIX_AT, after, [{ externalId: '1', registration: 'A' }]);
    const atTo = await client.fetchPositions(before, FIX_AT, [{ externalId: '1', registration: 'A' }]);
    expect(atFrom).toHaveLength(1);
    expect(atTo).toHaveLength(1);
  });

  it('excludes a fix one millisecond outside either end', async () => {
    const client = build({ data: [LEAF(1, 'A')] });
    const justAfterFrom = new Date(FIX_AT.getTime() + 1);
    const justBeforeTo = new Date(FIX_AT.getTime() - 1);
    expect(await client.fetchPositions(justAfterFrom, after, [{ externalId: '1', registration: 'A' }])).toEqual([]);
    expect(await client.fetchPositions(before, justBeforeTo, [{ externalId: '1', registration: 'A' }])).toEqual([]);
  });

  it('returns nothing for a vehicle the portal has no fix for', async () => {
    const client = build({ data: [LEAF(1, 'A', { Lat: null, Long: null })] });
    expect(await client.fetchPositions(before, after, [{ externalId: '1', registration: 'A' }])).toEqual([]);
  });

  // One request for the whole fleet — the point of moving off the report flow,
  // which issued one job per vehicle per chunk.
  it('makes exactly one request regardless of how many vehicles are asked for', async () => {
    const t = treeFetch({ data: [LEAF(1, 'A'), LEAF(2, 'B'), LEAF(3, 'C')] });
    const client = netstarClient({
      baseUrl: 'https://x.test', username: 'u', password: 'p',
      fetchImpl: t.fetchImpl, sleep: async () => {},
    });
    await client.fetchPositions(before, after, [
      { externalId: '1', registration: 'A' },
      { externalId: '2', registration: 'B' },
      { externalId: '3', registration: 'C' },
    ]);
    expect(t.seen).toHaveLength(1);
  });
});

describe('netstarClient — one tree download per tick', () => {
  // pollProvider calls listVehicles, then fetchPositions, then feedFreshness on
  // the SAME client within milliseconds. Without the memo that is three
  // multi-MB downloads every two hours in a process with a prod OOM history,
  // and the three copies can disagree with each other mid-tick.
  it('serves listVehicles, fetchPositions and feedFreshness from one request', async () => {
    const t = treeFetch({ data: [LEAF(1, 'A')] });
    const client = netstarClient({
      baseUrl: 'https://x.test', username: 'u', password: 'p',
      fetchImpl: t.fetchImpl, sleep: async () => {},
    });
    await client.listVehicles();
    await client.fetchPositions(new Date(0), new Date('2100-01-01'), [
      { externalId: '1', registration: 'A' },
    ]);
    await client.feedFreshness();
    expect(t.seen).toHaveLength(1);
  });

  it('refetches on a later tick rather than caching across them', async () => {
    let clock = 0;
    const t = treeFetch({ data: [LEAF(1, 'A')] });
    const client = netstarClient({
      baseUrl: 'https://x.test', username: 'u', password: 'p',
      fetchImpl: t.fetchImpl, sleep: async () => {}, now: () => clock, treeTtlMs: 60_000,
    });
    await client.listVehicles();
    clock += 2 * 60 * 60 * 1000; // next 2-hourly tick
    await client.listVehicles();
    expect(t.seen).toHaveLength(2);
  });

  it('reports the newest fix across the WHOLE account, including foreign vehicles', async () => {
    // The dead-feed probe deliberately spans other companies' vehicles: if it
    // only looked at ours, a parked weekend would be indistinguishable from an
    // outage — which is the failure it exists to catch.
    const t = treeFetch({ data: [
      LEAF(1, 'OURS', { DateTimeUtc: '/Date(1786000000000)/' }),
      LEAF(2, 'THEIRS', { DateTimeUtc: '/Date(1786039740000)/', GroupName: 'Motus' }),
    ] });
    const client = netstarClient({
      baseUrl: 'https://x.test', username: 'u', password: 'p',
      fetchImpl: t.fetchImpl, sleep: async () => {},
    });
    expect((await client.feedFreshness())?.toISOString()).toBe('2026-08-06T18:09:00.000Z');
  });

  it('returns null freshness for an account with no usable fix at all', async () => {
    const t = treeFetch({ data: [LEAF(1, 'A', { Lat: null, Long: null })] });
    const client = netstarClient({
      baseUrl: 'https://x.test', username: 'u', password: 'p',
      fetchImpl: t.fetchImpl, sleep: async () => {},
    });
    expect(await client.feedFreshness()).toBeNull();
  });
});
