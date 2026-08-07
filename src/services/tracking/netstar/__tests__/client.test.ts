import { describe, it, expect, vi } from 'vitest';
import { chunkWindow, MAX_REPORT_MS, netstarClient, PartialFetchError } from '../client';

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

interface ReportCall {
  selectedIds: unknown;
  selectedNames: unknown;
  startTime: unknown;
  stopTime: unknown;
}

const ONE_ROW_CSV = [
  'Time,Speed,Status,Gps,Speed Limit,Latitude,Longitude,Odometer',
  '04/08/2026 07:26:38,"0,0",Ignition on,true,"60,0","-26,08975","28,35431",54302',
].join('\n');

function reportFetch(exportStatuses: number[]) {
  const generated: ReportCall[] = [];
  let exportCall = 0;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url.endsWith('/Authentication/Account/Login')) {
      return new Response(LOGIN_PAGE, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    if (url.endsWith('/Authentication/')) {
      return new Response(null, { status: 302, headers: { location: '/VigilCloud4/Main' } });
    }
    if (url.includes('/Reports/ReportRepo/GenerateReport')) {
      const payload: unknown = JSON.parse(String(init?.body ?? '{}'));
      const p = payload as Record<string, unknown>;
      generated.push({
        selectedIds: p.selectedIds, selectedNames: p.selectedNames,
        startTime: p.startTime, stopTime: p.stopTime,
      });
      return new Response(`"job-${generated.length}"`, { status: 200 });
    }
    if (url.includes('/Reports/Export')) {
      const status = exportStatuses[exportCall] ?? 200;
      exportCall++;
      if (status !== 200) return new Response('not ready', { status });
      return new Response(ONE_ROW_CSV, { status: 200 });
    }
    throw new Error(`reportFetch: unexpected url ${url}`);
  };
  return { fetchImpl, generated, exportCalls: () => exportCall };
}

describe('netstarClient fetchHistory (report/CSV path)', () => {
  const from = new Date('2026-08-04T00:00:00Z');
  const to = new Date('2026-08-05T00:00:00Z');

  function build(exportStatuses: number[]) {
    const f = reportFetch(exportStatuses);
    const sleep = vi.fn(async () => {});
    const client = netstarClient({
      baseUrl: 'https://x.test', username: 'u', password: 'p',
      fetchImpl: f.fetchImpl, sleep,
    });
    return { ...f, sleep, client };
  }

  it('requests ONE report per vehicle and stamps each row with that vehicle externalId', async () => {
    // The export carries no vehicle column at all, so a report covering two
    // vehicles would produce rows nobody could attribute — one vehicle's trip
    // silently filed under another's. One report per vehicle plus this stamp
    // is the entire defence, so it gets asserted directly.
    const { client, generated } = build([200, 200]);
    const positions = await client.fetchHistory(from, to, [
      { externalId: '1447952', registration: 'LN40MGGP' },
      { externalId: '1447953', registration: 'LG94NLGP' },
    ]);

    expect(generated).toHaveLength(2);
    expect(generated[0]?.selectedIds).toEqual([1447952]);
    expect(generated[0]?.selectedNames).toEqual(['LN40MGGP']);
    expect(generated[1]?.selectedIds).toEqual([1447953]);
    expect(generated[1]?.selectedNames).toEqual(['LG94NLGP']);

    expect(positions).toHaveLength(2);
    expect(positions.map((p) => p.externalId)).toEqual(['1447952', '1447953']);
  });

  it('paces the per-vehicle reports instead of firing them back-to-back', async () => {
    const { client, sleep } = build([200, 200, 200]);
    await client.fetchHistory(from, to, [
      { externalId: '1', registration: 'A' },
      { externalId: '2', registration: 'B' },
      { externalId: '3', registration: 'C' },
    ]);
    // Between the reports, not before the first: three vehicles, two pauses.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('treats a 503 from the export as "not ready yet" and succeeds on the retry', async () => {
    const { client, exportCalls } = build([503, 200]);
    const positions = await client.fetchHistory(from, to, [
      { externalId: '1447952', registration: 'LN40MGGP' },
    ]);
    expect(exportCalls()).toBe(2);
    expect(positions).toHaveLength(1);
    expect(positions[0]?.externalId).toBe('1447952');
  });

  it('retries a 404 as well — generation is async and the job may not exist yet', async () => {
    const { client, exportCalls } = build([404, 200]);
    const positions = await client.fetchHistory(from, to, [
      { externalId: '1447952', registration: 'LN40MGGP' },
    ]);
    expect(exportCalls()).toBe(2);
    expect(positions).toHaveLength(1);
  });

  it('throws once the bounded attempts are exhausted rather than returning nothing', async () => {
    // Returning [] here would look exactly like "this vehicle did not move",
    // and the watermark would advance over the window regardless.
    const { client, exportCalls } = build(Array.from({ length: 12 }, () => 503));
    await expect(client.fetchHistory(from, to, [
      { externalId: '1447952', registration: 'LN40MGGP' },
    ])).rejects.toThrow('export never became ready');
    expect(exportCalls()).toBe(10);
  });

  it('fails the run on a non-retryable export status instead of retrying it', async () => {
    const { client, exportCalls } = build([500, 200]);
    await expect(client.fetchHistory(from, to, [
      { externalId: '1447952', registration: 'LN40MGGP' },
    ])).rejects.toThrow('[netstar] Export: HTTP 500');
    expect(exportCalls()).toBe(1);
  });

  it('splits a window wider than the report cap into one report per vehicle per chunk', async () => {
    const { client, generated } = build([200, 200, 200, 200]);
    const wide = new Date('2026-05-01T00:00:00Z');
    const end = new Date('2026-07-01T00:00:00Z');
    await client.fetchHistory(wide, end, [
      { externalId: '1', registration: 'A' },
      { externalId: '2', registration: 'B' },
    ]);
    // 61 days -> 2 chunks, 2 vehicles -> 4 reports.
    expect(generated).toHaveLength(4);
    expect(new Date(String(generated[0]?.startTime)).getTime()).toBe(wide.getTime());
  });
});

/**
 * Per-vehicle isolation.
 *
 * The loop used to let any throw escape, which discarded every position already
 * collected for the other vehicles. Because the caller leaves the watermark
 * untouched on a throw, the next tick re-requested the identical window and hit
 * the same stuck vehicle again — one bad report became a permanent fleet-wide
 * blackout.
 */
describe('netstarClient.fetchHistory — one bad vehicle must not blank the fleet', () => {
  const FROM = new Date('2026-08-01T00:00:00Z');
  const TO = new Date('2026-08-02T00:00:00Z');
  const CSV = [
    'Driver,Driver Department,Driver Unique Code,Time,Speed,Address,Status,Gps,Speed Limit,Latitude,Longitude,RPM,Battery Voltage,Odometer',
    'No driver,,,01/08/2026 10:00:00,"0",Somewhere,Ignition on,true,"60","-26,08975","28,35431","0","12,8","5430"',
  ].join('\r\n');

  /**
   * Answers login, then GenerateReport/Export per vehicle. `broken` names the
   * external ids whose export never succeeds.
   */
  function reportFetch(broken: string[]) {
    let pendingVehicle = '';
    return async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/Authentication/Account/Login')) {
        return new Response(LOGIN_PAGE, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      if (url.endsWith('/Authentication/')) {
        return new Response(null, { status: 302, headers: { location: '/VigilCloud4/Main' } });
      }
      if (url.includes('/GenerateReport')) {
        const body = JSON.parse(String(init?.body)) as { selectedIds: number[] };
        pendingVehicle = String(body.selectedIds[0]);
        return new Response(`"job-${pendingVehicle}"`, { status: 200 });
      }
      if (url.includes('/Reports/Export')) {
        const jobId = (JSON.parse(String(init?.body)) as { reportId: string }).reportId;
        const vehicle = jobId.replace('job-', '');
        // 500 is not a retryable status, so this fails the vehicle immediately.
        if (broken.includes(vehicle)) return new Response(null, { status: 500 });
        return new Response(CSV, { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    };
  }

  function client(broken: string[], overrides = {}) {
    return netstarClient({
      baseUrl: 'https://portal.example.com',
      username: 'u', password: 'p',
      fetchImpl: reportFetch(broken) as unknown as typeof fetch,
      sleep: async () => {},
      ...overrides,
    });
  }

  const vehicles = [
    { externalId: '111', registration: 'AA11AAGP' },
    { externalId: '222', registration: 'BB22BBGP' },
    { externalId: '333', registration: 'CC33CCGP' },
  ];

  it('returns every healthy vehicle when one fails, as a PartialFetchError', async () => {
    const err = await client(['222']).fetchHistory(FROM, TO, vehicles).catch((e) => e);

    expect(err).toBeInstanceOf(PartialFetchError);
    expect(err.positions).toHaveLength(2);
    expect(err.positions.map((p: { externalId: string }) => p.externalId)).toEqual(['111', '333']);
    expect(err.failures.map((f: { externalId: string }) => f.externalId)).toEqual(['222']);
  });

  it('throws a plain Error when every vehicle fails, so the tick fails outright', async () => {
    // Nothing was fetched, so there is nothing to store and the watermark must
    // not move — that is the existing total-failure path, not a partial one.
    const err = await client(['111', '222', '333']).fetchHistory(FROM, TO, vehicles).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PartialFetchError);
    expect(err.message).toMatch(/every vehicle report failed \(3\)/);
  });

  it('resolves normally when nothing fails', async () => {
    const positions = await client([]).fetchHistory(FROM, TO, vehicles);
    expect(positions.map((p) => p.externalId)).toEqual(['111', '222', '333']);
  });
});

describe('netstarClient.fetchHistory — runtime budget', () => {
  it('stops at the budget and reports the rest as failures rather than running past the next tick', async () => {
    // Worst case is ~11 minutes per vehicle; at 22 vehicles a degenerate portal
    // outruns the 2-hour cadence, and every later tick then skips on the
    // advisory lock with a 200 while tracking is dead.
    let clock = 0;
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/Authentication/Account/Login')) {
        return new Response(LOGIN_PAGE, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      if (url.endsWith('/Authentication/')) {
        return new Response(null, { status: 302, headers: { location: '/VigilCloud4/Main' } });
      }
      if (url.includes('/GenerateReport')) {
        clock += 10 * 60 * 1000; // each vehicle burns ten minutes
        const body = JSON.parse(String(init?.body)) as { selectedIds: number[] };
        return new Response(`"job-${body.selectedIds[0]}"`, { status: 200 });
      }
      if (url.includes('/Reports/Export')) {
        return new Response(
          'Driver,Driver Department,Driver Unique Code,Time,Speed,Address,Status,Gps,Speed Limit,Latitude,Longitude,RPM,Battery Voltage,Odometer',
          { status: 200 }
        );
      }
      throw new Error(`unexpected url ${url}`);
    };

    const c = netstarClient({
      baseUrl: 'https://portal.example.com',
      username: 'u', password: 'p',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      now: () => clock,
      maxRuntimeMs: 25 * 60 * 1000,
    });

    const many = Array.from({ length: 6 }, (_, i) => ({
      externalId: String(i), registration: `Z${i}`,
    }));
    const err = await c.fetchHistory(
      new Date('2026-08-01T00:00:00Z'), new Date('2026-08-02T00:00:00Z'), many
    ).catch((e) => e);

    expect(err).toBeInstanceOf(PartialFetchError);
    // Three vehicles fit inside 25 minutes at ten minutes each; the rest are
    // recorded as budget failures so the caller holds the watermark and the
    // next tick resumes rather than losing them.
    expect(err.failures).toHaveLength(3);
    expect(err.failures.every((f: { error: string }) => f.error === 'runtime budget exhausted')).toBe(true);
  });
});

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

/**
 * The login is anti-forgery protected and the form does NOT post back to the
 * URL that serves it. Getting either wrong establishes no session, and the
 * failure surfaces much later as "still logged out after re-auth" against
 * whatever endpoint happened to run next — which is exactly how this shipped.
 */
describe('netstarClient login', () => {
  function build(loginPage?: string) {
    const t = treeFetch({ data: [LEAF(1, 'A')] }, 200, loginPage);
    return { ...t, client: netstarClient({
      baseUrl: 'https://x.test/VigilCloud4', username: 'u', password: 'p',
      fetchImpl: t.fetchImpl, sleep: async () => {},
    }) };
  }

  it('POSTs to /Authentication/, not to the page that served the form', async () => {
    const { client, logins } = build();
    await client.listVehicles();
    expect(logins).toHaveLength(1);
    expect(logins[0]!.url).toBe('https://x.test/VigilCloud4/Authentication/');
  });

  it('carries the __RequestVerificationToken lifted from the page', async () => {
    const { client, logins } = build();
    await client.listVehicles();
    const sent = new URLSearchParams(logins[0]!.body);
    expect(sent.get('__RequestVerificationToken')).toBe('TOKEN-abc123');
    expect(sent.get('UserName')).toBe('u');
    expect(sent.get('Password')).toBe('p');
  });

  it('submits the timezone fields the form carries', async () => {
    const { client, logins } = build();
    await client.listVehicles();
    const sent = new URLSearchParams(logins[0]!.body);
    expect(sent.get('timeZone')).toBe('120');
    expect(sent.get('timeZoneName')).toBe('South Africa Standard Time');
  });

  // Naming the cause here beats a logged-out error three calls later.
  it('fails loudly when the page carries no token', async () => {
    const { client } = build('<html><form action="/x"><input name="UserName" /></form></html>');
    await expect(client.listVehicles()).rejects.toThrow(/no __RequestVerificationToken/);
  });
});
