import { describe, it, expect, vi } from 'vitest';
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

/**
 * One valid row is enough: the parser is exercised in full against a captured
 * export in parse.test.ts. What these tests are about is the request flow
 * around it — how many reports get generated, and whose id each row ends up
 * carrying.
 */
const ONE_ROW_CSV = [
  'Time,Speed,Status,Gps,Speed Limit,Latitude,Longitude,Odometer',
  '04/08/2026 07:26:38,"0,0",Ignition on,true,"60,0","-26,08975","28,35431",54302',
].join('\n');

interface ReportCall {
  selectedIds: unknown;
  selectedNames: unknown;
  startTime: unknown;
  stopTime: unknown;
}

/**
 * Records every GenerateReport payload and answers /Reports/Export with a
 * caller-supplied sequence of statuses, so the retry loop can be driven
 * deterministically.
 */
function reportFetch(exportStatuses: number[]) {
  const generated: ReportCall[] = [];
  let exportCall = 0;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url.includes('/Authentication/Account/Login')) {
      return new Response(null, { status: 200 });
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

describe('netstarClient fetchPositions', () => {
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
    const positions = await client.fetchPositions(from, to, [
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
    await client.fetchPositions(from, to, [
      { externalId: '1', registration: 'A' },
      { externalId: '2', registration: 'B' },
      { externalId: '3', registration: 'C' },
    ]);
    // Between the reports, not before the first: three vehicles, two pauses.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('treats a 503 from the export as "not ready yet" and succeeds on the retry', async () => {
    const { client, exportCalls } = build([503, 200]);
    const positions = await client.fetchPositions(from, to, [
      { externalId: '1447952', registration: 'LN40MGGP' },
    ]);
    expect(exportCalls()).toBe(2);
    expect(positions).toHaveLength(1);
    expect(positions[0]?.externalId).toBe('1447952');
  });

  it('retries a 404 as well — generation is async and the job may not exist yet', async () => {
    const { client, exportCalls } = build([404, 200]);
    const positions = await client.fetchPositions(from, to, [
      { externalId: '1447952', registration: 'LN40MGGP' },
    ]);
    expect(exportCalls()).toBe(2);
    expect(positions).toHaveLength(1);
  });

  it('throws once the bounded attempts are exhausted rather than returning nothing', async () => {
    // Returning [] here would look exactly like "this vehicle did not move",
    // and the watermark would advance over the window regardless.
    const { client, exportCalls } = build(Array.from({ length: 12 }, () => 503));
    await expect(client.fetchPositions(from, to, [
      { externalId: '1447952', registration: 'LN40MGGP' },
    ])).rejects.toThrow('export never became ready');
    expect(exportCalls()).toBe(10);
  });

  it('fails the run on a non-retryable export status instead of retrying it', async () => {
    const { client, exportCalls } = build([500, 200]);
    await expect(client.fetchPositions(from, to, [
      { externalId: '1447952', registration: 'LN40MGGP' },
    ])).rejects.toThrow('[netstar] Export: HTTP 500');
    expect(exportCalls()).toBe(1);
  });

  it('splits a window wider than the report cap into one report per vehicle per chunk', async () => {
    const { client, generated } = build([200, 200, 200, 200]);
    const wide = new Date('2026-05-01T00:00:00Z');
    const end = new Date('2026-07-01T00:00:00Z');
    await client.fetchPositions(wide, end, [
      { externalId: '1', registration: 'A' },
      { externalId: '2', registration: 'B' },
    ]);
    // 61 days -> 2 chunks, 2 vehicles -> 4 reports.
    expect(generated).toHaveLength(4);
    expect(new Date(String(generated[0]?.startTime)).getTime()).toBe(wide.getTime());
  });
});
