/**
 * Netstar VigilCloud portal client.
 *
 * VigilCloud is a human portal, but its report builder is backed by a JSON
 * endpoint, so this speaks HTTP rather than driving a browser. Contract
 * captured live on 2026-08-05:
 *
 *   POST /VigilCloud4/Reports/ReportRepo/GenerateReport/  -> "<jobId>"  (async)
 *   POST /VigilCloud4/Reports/Export                      -> CSV bytes
 *
 * Report generation is ASYNCHRONOUS: GenerateReport returns a job id, not data.
 *
 * The login form's inputs carry readonly="readonly" with an onmousedown handler
 * that clears it — an anti-autofill measure that only affects browser
 * automation. Posting the form directly sidesteps it entirely, which is a large
 * part of why this is an HTTP client and not Playwright.
 */
import { PortalSession, type CookieJar } from '../portal/session';
import { parseAllActivityCsv } from './parse';
import type { PortalVehicle } from '../portal/registration';
import type { ProviderPosition } from '../types';
import { log } from '@/lib/logger';

/** Portal-enforced: "This report is limited to 31 days". Verified 2026-08-05. */
export const MAX_REPORT_MS = 31 * 24 * 60 * 60 * 1000;

const REPORT_ID = 'Mobiles.IndividualReports.AllActivity';
const TIMEZONE = 'South Africa Standard Time';
/** Generation is async; poll the export until it stops reporting "not ready". */
const EXPORT_ATTEMPTS = 10;
const EXPORT_DELAY_MS = 3_000;

export interface NetstarClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  fetchImpl?: typeof fetch;
  /** Injectable so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export interface NetstarClient {
  listVehicles(): Promise<PortalVehicle[]>;
  fetchPositions(from: Date, to: Date, vehicles: PortalVehicle[]): Promise<ProviderPosition[]>;
}

/** Split a window into contiguous chunks no wider than `maxMs`. */
export function chunkWindow(
  from: Date,
  to: Date,
  maxMs: number
): Array<{ from: Date; to: Date }> {
  const out: Array<{ from: Date; to: Date }> = [];
  let cursor = from.getTime();
  const end = to.getTime();
  if (!(cursor < end)) return out;
  while (cursor < end) {
    const next = Math.min(cursor + maxMs, end);
    out.push({ from: new Date(cursor), to: new Date(next) });
    cursor = next;
  }
  return out;
}

export function netstarClient(opts: NetstarClientOptions): NetstarClient {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const session = new PortalSession({
    baseUrl: opts.baseUrl,
    fetchImpl: opts.fetchImpl,
    isLoggedOut: (res) =>
      res.status === 302 && /Account\/Login/i.test(res.headers.get('location') ?? ''),
    login: async (fetchImpl, jar: CookieJar) => {
      const url = `${opts.baseUrl.replace(/\/+$/, '')}/Authentication/Account/Login`;
      const body = new URLSearchParams({
        UserName: opts.username,
        Password: opts.password,
      });
      const res = await fetchImpl(url, {
        method: 'POST',
        body,
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: jar.header(),
        },
      });
      jar.absorb(res);
      if (res.status >= 400) {
        throw new Error(`[netstar] login failed: HTTP ${res.status}`);
      }
    },
  });

  async function listVehicles(): Promise<PortalVehicle[]> {
    const res = await session.request('/Reports/ReportRepo/GetReportTree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ reportTree: 'Vehicles' }),
    });
    if (!res.ok) throw new Error(`[netstar] vehicle list: HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) {
      throw new Error(`[netstar] vehicle list: expected an array, got ${typeof body}`);
    }

    // Validated at runtime rather than cast: an untrusted response that is
    // silently trusted here would surface downstream as "no vehicles on this
    // account" instead of "we failed to parse the response" — exactly the
    // kind of silent coverage loss this feature exists to prevent. A single
    // malformed element is skipped rather than failing the whole list.
    const out: PortalVehicle[] = [];
    for (const item of body) {
      if (typeof item !== 'object' || item === null || !('id' in item)) continue;
      const id = item.id;
      if (typeof id !== 'string' && typeof id !== 'number') continue;
      const name = 'name' in item ? item.name : undefined;
      out.push({ externalId: String(id), registration: typeof name === 'string' ? name : null });
    }
    return out;
  }

  async function fetchChunk(
    from: Date,
    to: Date,
    vehicles: PortalVehicle[]
  ): Promise<ProviderPosition[]> {
    const payload = {
      reportId: REPORT_ID,
      reportName: 'All Activity',
      startTime: from.toISOString(),
      stopTime: to.toISOString(),
      scheduleForAllNew: false,
      sortAscending: true,
      embededMap: false,
      useVehicleTimeZone: false,
      selectedTimeZone: TIMEZONE,
      selectedIds: vehicles.map((v) => Number(v.externalId)),
      selectedNames: vehicles.map((v) => v.registration ?? ''),
      reportBy: 'Vehicle',
      reportTree: 'Vehicles',
      reportGroup: 'Detailed',
      customPanelName: '',
      category: 'Individual',
    };

    const gen = await session.request('/Reports/ReportRepo/GenerateReport/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!gen.ok) throw new Error(`[netstar] GenerateReport: HTTP ${gen.status}`);
    const jobId = (await gen.text()).replace(/^"|"$/g, '');
    if (!jobId) throw new Error('[netstar] GenerateReport returned no job id');

    // Generation is asynchronous. A 503 here was observed once during recon and
    // is treated as "not ready yet" rather than fatal — but only for a bounded
    // number of attempts, so a genuinely broken export still fails the run.
    for (let attempt = 1; attempt <= EXPORT_ATTEMPTS; attempt++) {
      const exp = await session.request('/Reports/Export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/csv' },
        body: JSON.stringify({ reportId: jobId, outputFormat: 'CSV' }),
      });
      if (exp.ok) {
        const positions = parseAllActivityCsv(await exp.text());
        // The export carries no vehicle identifier at all (no registration or
        // id column — see __tests__/fixtures/README.md), so a report covering
        // several vehicles would produce rows nobody could attribute. That is
        // why fetchPositions requests exactly one vehicle per report and this
        // stamps its externalId onto every row it returns.
        return positions.map((p) => ({
          ...p,
          externalId: p.externalId || (vehicles[0]?.externalId ?? ''),
        }));
      }
      if (exp.status !== 503 && exp.status !== 404) {
        throw new Error(`[netstar] Export: HTTP ${exp.status}`);
      }
      log.info('[netstar] export not ready, retrying', { jobId, attempt });
      await sleep(EXPORT_DELAY_MS);
    }
    throw new Error(`[netstar] export never became ready for job ${jobId}`);
  }

  return {
    listVehicles,
    async fetchPositions(from, to, vehicles) {
      const all: ProviderPosition[] = [];
      for (const chunk of chunkWindow(from, to, MAX_REPORT_MS)) {
        for (const v of vehicles) {
          all.push(...(await fetchChunk(chunk.from, chunk.to, [v])));
        }
      }
      return all;
    },
  };
}
