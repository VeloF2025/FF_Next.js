/**
 * Cartrack implementation of TrackingProvider.
 *
 * Deliberately separate from client.ts: that module serves attendance's
 * point-in-time fetchPositionAt and is live. This adds the window fetch the
 * poller needs without disturbing it.
 *
 * The events endpoint returns 44 fields; we keep the 14 that carry meaning.
 * The rest (temp1-4, analog_*, adc*, dynamic1-4, vext, vgsm, rpm) are
 * constant-zero or irrelevant to fleet safety.
 *
 * Timestamp parsing reuses `parseSampleTs` from `./client` rather than
 * duplicating it — it already handles Cartrack's two-digit UTC offset
 * (`+02`), which neither a `[+-]\d{2}:?\d{2}$` regex nor `new Date(...)`
 * parses correctly on its own (see client.ts for the verified traps).
 */
import { log } from '@/lib/logger';
import { cartrackTsFormat, parseSampleTs } from './client';
import type { ProviderPosition, ProviderVehicle, TrackingProvider } from '../types';

const TIMEOUT_MS = 20_000;
const MAX_PAGES = 20;
const PAGE_SIZE = 1000;

export interface CartrackProviderOptions {
  baseUrl: string;
  username: string;
  password: string;
  accountRef: string;
  fetchImpl?: typeof fetch;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean | null {
  if (v === true || v === 'true' || v === 'True') return true;
  if (v === false || v === 'false' || v === 'False') return false;
  return null;
}

export function cartrackProvider(opts: CartrackProviderOptions): TrackingProvider {
  const auth = 'Basic ' + Buffer.from(`${opts.username}:${opts.password}`).toString('base64');
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, '');

  async function getJson(url: string): Promise<{ data?: unknown[]; meta?: { last_page?: number } }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(url, {
        method: 'GET',
        headers: { Authorization: auth, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Cartrack HTTP ${res.status} for ${url.split('?')[0]}`);
      return (await res.json()) as { data?: unknown[]; meta?: { last_page?: number } };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    key: 'cartrack',
    accountRef: opts.accountRef,

    async listVehicles(): Promise<ProviderVehicle[]> {
      const body = await getJson(`${base}/vehicles?limit=500&page=1`);
      const rows = (body.data ?? []) as Array<Record<string, unknown>>;
      // In the SA tenant `registration` is an internal placeholder
      // (e.g. TEMP-2084956); the real plate is in `vehicle_name`.
      return rows
        .map((v) => ({
          externalId: String(v.vehicle_id ?? ''),
          registration: (v.vehicle_name as string) ?? null,
          description: [v.manufacturer, v.model].filter(Boolean).join(' ').trim() || null,
        }))
        .filter((v) => v.externalId.length > 0);
    },

    async fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]> {
      const out: ProviderPosition[] = [];
      let noFix = 0;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url =
          `${base}/vehicles/events` +
          `?start_timestamp=${encodeURIComponent(cartrackTsFormat(from))}` +
          `&end_timestamp=${encodeURIComponent(cartrackTsFormat(to))}` +
          `&limit=${PAGE_SIZE}&page=${page}`;
        const body = await getJson(url);
        const rows = (body.data ?? []) as Array<Record<string, unknown>>;
        for (const r of rows) {
          const ts = typeof r.event_ts === 'string' ? parseSampleTs(r.event_ts) : null;
          const lat = num(r.latitude);
          const lon = num(r.longitude);
          if (!ts || lat === null || lon === null) { noFix++; continue; }
          const odoM = num(r.odometer);
          out.push({
            externalId: String(r.vehicle_id ?? ''),
            providerEventId: r.event_id === undefined || r.event_id === null ? null : String(r.event_id),
            recordedAt: ts,
            lat, lon,
            speedKph: num(r.speed),
            roadSpeedKph: num(r.road_speed),
            isSpeeding: bool(r.road_speeding),
            ignition: bool(r.ignition),
            odometerKm: odoM === null ? null : odoM / 1000,
            linearG: num(r.linear_g),
            lateralG: num(r.lateral_g),
            bearing: num(r.bearing),
            altitudeM: num(r.altitude),
            gpsFixType: num(r.gps_fix_type),
          });
        }
        if (page >= (body.meta?.last_page ?? 1)) break;
      }
      if (noFix > 0) {
        log.warn('[cartrack-provider] events skipped for missing fix or timestamp', { noFix });
      }
      return out;
    },
  };
}
