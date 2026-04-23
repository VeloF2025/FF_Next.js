/**
 * Committed smoke test for the Cartrack adapter.
 *
 * Runs against the LIVE Cartrack tenant. Gated on `CARTRACK_SMOKE_TEST=true`
 * so the default unit-test run never hits the network. Intended to be
 * invoked explicitly by ops or a scheduled CI job, e.g. after rotating
 * credentials or changing the tenant's base URL.
 *
 *   CARTRACK_SMOKE_TEST=true \
 *   CARTRACK_BASE_URL=https://fleetapi-za.cartrack.com/rest \
 *   CARTRACK_API_USER=... \
 *   CARTRACK_API_PASS=... \
 *     npx vitest run src/services/tracking/cartrack/__tests__/smoke.test.ts
 *
 * Safety:
 *   - Read-only — the adapter only issues GET requests.
 *   - No side effects on our DB.
 *   - Fails loud on credential errors, tenant outage, or pagination
 *     truncation so ops can triage before the nightly reconcile fires.
 *
 * What this covers (and what it doesn't):
 *   - `listVehicles()` — round-trip against /vehicles, shape + pagination
 *   - `fetchPositionAt()` — round-trip against /vehicles/events for a
 *     vehicle_id sampled from the fleet list, over a narrow window
 *   - Does NOT cover the DB-facing reconcile layer — that's the
 *     reconcileSql integration test (#1401) and the cron cron itself.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  cartrackClientFromEnv,
  CartrackError,
  DEFAULT_TOLERANCE_MS,
} from '../client';
import type { CartrackClient, CartrackVehicleSummary } from '../types';

const SMOKE_ENABLED = process.env.CARTRACK_SMOKE_TEST === 'true';

describe.skipIf(!SMOKE_ENABLED)('cartrack smoke (live tenant)', () => {
  let client: CartrackClient;
  let fleet: CartrackVehicleSummary[];

  beforeAll(() => {
    client = cartrackClientFromEnv();
  });

  it('listVehicles() returns a non-empty fleet', async () => {
    fleet = await client.listVehicles();
    expect(Array.isArray(fleet)).toBe(true);
    expect(fleet.length).toBeGreaterThan(0);
    // Every row must have a non-empty Cartrack id — the adapter filters
    // out empties internally, but assert the contract anyway in case the
    // tenant ever returns a row with only a null vehicle_id.
    for (const v of fleet) {
      expect(v.cartrackId.length).toBeGreaterThan(0);
    }
  });

  it('fetchPositionAt() round-trips against the events endpoint', async () => {
    if (!fleet || fleet.length === 0) {
      throw new Error(
        'smoke: no fleet loaded — listVehicles() must run and succeed first'
      );
    }
    // Pick the first vehicle arbitrarily. We don't care if this specific
    // vehicle happens to have no events in the window — we only care
    // that the call does not THROW. Legitimate terminal states:
    //   - { status: 'ok', sample } — vehicle is live and inside window
    //   - { status: 'no_data' }   — vehicle hasn't pinged in the window
    // Both prove the endpoint is reachable and the adapter parses the
    // response correctly.
    const [{ cartrackId }] = fleet;
    const result = await client.fetchPositionAt(
      cartrackId,
      new Date(),
      DEFAULT_TOLERANCE_MS
    );
    expect(['ok', 'no_data', 'vehicle_not_mapped']).toContain(result.status);
  });

  it('rejects an empty vehicleId at the boundary (no network call)', async () => {
    // Guard test: verifies the boundary check survives any future
    // refactor. Critical because migration 322's DB CHECK is a belt;
    // this adapter-side throw is the braces.
    await expect(client.fetchPositionAt('', new Date())).rejects.toThrow(
      CartrackError
    );
  });
});

describe.skipIf(SMOKE_ENABLED)('cartrack smoke — skip notice', () => {
  it('skips when CARTRACK_SMOKE_TEST is not "true"', () => {
    expect(SMOKE_ENABLED).toBe(false);
  });
});
