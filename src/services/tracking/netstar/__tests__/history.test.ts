import { describe, it, expect, vi } from 'vitest';
import { netstarClient, PartialFetchError } from '../client';

/**
 * The report/CSV path (netstar/history.ts), reached only by the backfill script.
 * These endpoints are UNVERIFIED against the live portal — documented in the same
 * pass that had the vehicle list pointing at an endpoint that does not exist — so
 * these tests pin the shape we implemented, not a confirmed contract.
 */
const LOGIN_PAGE = '<html><form action="/VigilCloud4/Authentication/" method="post">'
  + '<input name="__RequestVerificationToken" type="hidden" value="TOKEN-abc123" />'
  + '</form></html>';

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

  // The export carries no vehicle column, so a multi-vehicle report produces
  // rows nobody can attribute. One report per vehicle plus the stamp is the
  // entire defence, so it is asserted directly.
  it('requests ONE report per vehicle and stamps each row with that vehicle externalId', async () => {
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
 * Per-vehicle isolation. Any escaping throw used to discard every position
 * already collected for the other vehicles, and since the caller holds the
 * watermark on a throw, the next run hit the same stuck vehicle again — one bad
 * report became a permanent fleet-wide blackout.
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
