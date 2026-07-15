/**
 * End-to-end watermark tests using the REAL ingestPositions() (not mocked),
 * driven by realistic ProviderPosition objects.
 *
 * poll-tracking.test.ts mocks ingestPositions and pins the (trivial) wiring
 * from its returned maxIngestedAt into the SQL upsert. This file instead
 * exercises the actual future-date and unmapped-tracker guards inside
 * ingestPositions, so a regression in either one is caught here even if
 * someone "fixes" poll-tracking.ts in a way that keeps the mocked-ingest
 * tests green. This is what Important-4 in the review meant by "pin the
 * value written to last_event_ts" for Critical-2 and Important-3.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock, queryMock, poolConnectMock, cartrackProviderMock, logMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  queryMock: vi.fn(),
  poolConnectMock: vi.fn(),
  cartrackProviderMock: vi.fn(),
  logMock: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/db-pool', () => ({
  sql: (...a: unknown[]) => sqlMock(...a),
  query: (...a: unknown[]) => queryMock(...a),
  pool: { connect: (...a: unknown[]) => poolConnectMock(...a) },
}));
vi.mock('@/lib/logger', () => ({ log: logMock }));
vi.mock('@/services/tracking/cartrack/provider', () => ({
  cartrackProvider: (...a: unknown[]) => cartrackProviderMock(...a),
}));
// Deliberately NOT mocking '@/services/tracking/ingest' — see file header.

import handler from '../poll-tracking';
import type { ProviderPosition } from '@/services/tracking/types';

const SECRET = 'test-cron-secret';
const AUTH = { 'x-cron-secret': SECRET };
const INSERT_COLUMN_COUNT = 18; // vehicle_id..gps_fix_type in ingest.ts's COLUMNS

interface TrackerRow extends Record<string, unknown> {
  external_id: string;
  vehicle_id: string;
  tracker_id: string;
}

function pos(externalId: string, iso: string): ProviderPosition {
  return {
    externalId, providerEventId: `e-${externalId}-${iso}`, recordedAt: new Date(iso),
    lat: -26.2, lon: 28.04, speedKph: 50, roadSpeedKph: 60, isSpeeding: false,
    ignition: true, odometerKm: 1000, linearG: 0, lateralG: 0, bearing: 90,
    altitudeM: 1600, gpsFixType: 3,
  };
}

function trackerRow(externalId: string): TrackerRow {
  return { external_id: externalId, vehicle_id: `vehicle-${externalId}`, tracker_id: `tracker-${externalId}` };
}

function makeFakeClient() {
  return {
    query: vi.fn(async (text: string) => {
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
}

function makeFakeProvider(fetchPositions: () => Promise<ProviderPosition[]>) {
  return {
    key: 'cartrack' as const,
    accountRef: 'default',
    listVehicles: vi.fn().mockResolvedValue([]),
    fetchPositions: vi.fn(fetchPositions),
  };
}

/** Routes both poll-tracking.ts's and ingest.ts's sql`` calls by query shape. */
function stubSql({
  watermarkRow = null as { last_event_ts: string | null } | null,
  trackers = [] as TrackerRow[],
} = {}) {
  sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
    const text = strings.join('');
    if (text.includes('FROM fleet_vehicle_trackers')) return trackers;
    if (text.includes('SELECT last_event_ts')) return watermarkRow ? [watermarkRow] : [];
    return []; // INSERT INTO fleet_tracking_watermarks — captured via mock.calls, not a return value
  });
}

/** All submitted rows "land" (no ON CONFLICT drop) — good enough for watermark tests. */
function stubQueryAllLand() {
  queryMock.mockImplementation(async (_text: string, params: unknown[]) => {
    const rowCount = params.length / INSERT_COLUMN_COUNT;
    return Array.from({ length: rowCount }, (_, i) => ({ id: `row-${i}` }));
  });
}

function run() {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET', headers: AUTH });
  return handler(req, res).then(() => res);
}

function successUpsertLastEventTs(): unknown {
  const call = sqlMock.mock.calls.find((c) => {
    const text = (c[0] as TemplateStringsArray).join('');
    return text.includes('INSERT INTO fleet_tracking_watermarks') && text.includes('last_event_ts');
  });
  if (!call) throw new Error('no success-path watermark upsert found');
  return call[3];
}

describe('poll-tracking watermark, driven by the real ingestPositions()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    process.env.CARTRACK_BASE_URL = 'https://fleetapi.cartrack.com';
    process.env.CARTRACK_API_USER = 'user';
    process.env.CARTRACK_API_PASS = 'pass';
    process.env.CARTRACK_ACCOUNT_REF = 'default';
    poolConnectMock.mockImplementation(async () => makeFakeClient());
    stubSql();
    stubQueryAllLand();
  });

  it('advances to the max ingested timestamp, ignoring a future-dated position (Critical-2)', async () => {
    stubSql({ trackers: [trackerRow('v1'), trackerRow('v2')] });
    const early = '2026-07-15T08:00:00.000Z';
    const late = '2026-07-15T08:05:00.000Z';
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    cartrackProviderMock.mockReturnValue(makeFakeProvider(async () => [
      pos('v1', early),
      pos('v2', late),
      pos('v1', future), // clock-skewed device; must not become the watermark
    ]));

    await run();

    expect(successUpsertLastEventTs()).toEqual(new Date(late));
  });

  it('holds the existing watermark on an empty fetched batch', async () => {
    const lastEventTs = '2026-07-15T07:00:00.000Z';
    stubSql({ watermarkRow: { last_event_ts: lastEventTs }, trackers: [] });
    cartrackProviderMock.mockReturnValue(makeFakeProvider(async () => []));

    await run();

    expect(successUpsertLastEventTs()).toEqual(new Date(lastEventTs));
  });

  it('holds the existing watermark on an all-unmapped batch — does not burn the cold-start backfill (Important-3)', async () => {
    const lastEventTs = '2026-07-15T07:00:00.000Z';
    // No trackers mapped at all — e.g. migration 441 applied but mapping
    // hasn't landed yet. This is the guaranteed first-run production state.
    stubSql({ watermarkRow: { last_event_ts: lastEventTs }, trackers: [] });
    cartrackProviderMock.mockReturnValue(makeFakeProvider(async () => [
      pos('unmapped-1', '2026-07-15T08:00:00.000Z'),
      pos('unmapped-2', '2026-07-15T08:05:00.000Z'),
    ]));

    await run();

    expect(successUpsertLastEventTs()).toEqual(new Date(lastEventTs));
  });

  it('stays null on a cold-start all-unmapped batch — never fabricates a watermark', async () => {
    // No prior watermark row (cold start) AND nothing mapped: the written
    // value must stay null, or the 6h cold-start backfill window is lost
    // for good the moment mapping lands.
    stubSql({ watermarkRow: null, trackers: [] });
    cartrackProviderMock.mockReturnValue(makeFakeProvider(async () => [
      pos('unmapped-1', '2026-07-15T08:00:00.000Z'),
    ]));

    await run();

    expect(successUpsertLastEventTs()).toBeNull();
  });
});
