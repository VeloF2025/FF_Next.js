/**
 * Netstar as a TrackingProvider.
 *
 * Only vehicles already mapped in fleet_vehicle_trackers are requested. The
 * Netstar login is a multi-client reseller account whose tree contains other
 * companies' fleets entirely — asking for the whole account would pull
 * thousands of foreign positions that ingest would then discard one by one.
 */
import { sql } from '@/lib/db-pool';
import { netstarClient, type NetstarClient } from './client';
import type { PortalVehicle } from '../portal/registration';
import type { ProviderPosition, TrackingProvider } from '../types';

export interface NetstarProviderOptions {
  baseUrl: string;
  username: string;
  password: string;
  accountRef: string;
  /** Injectable for tests. */
  client?: NetstarClient;
  loadMappedVehicles?: () => Promise<PortalVehicle[]>;
}

async function mappedVehicles(accountRef: string): Promise<PortalVehicle[]> {
  const rows = await sql<{ external_id: string; registration: string }>`
    SELECT t.external_id, v.registration
    FROM fleet_vehicle_trackers t
    JOIN fleet_vehicles v ON v.id = t.vehicle_id
    WHERE t.provider = 'netstar' AND t.account_ref = ${accountRef} AND t.is_active
    ORDER BY v.registration
  `;
  return rows.map((r) => ({ externalId: r.external_id, registration: r.registration }));
}

export function netstarProvider(opts: NetstarProviderOptions): TrackingProvider {
  const client = opts.client ?? netstarClient(opts);
  const load = opts.loadMappedVehicles ?? (() => mappedVehicles(opts.accountRef));

  return {
    key: 'netstar',
    accountRef: opts.accountRef,
    // The portal poller sizes its window by the 31-day report cap, not by an
    // event budget, so resolveWindow() is not used for this provider. Opting
    // out of that clamp is only safe because poll-portal-tracking.ts applies
    // its own floor (MAX_POLL_WINDOW_MS) — without it a stale watermark would
    // fan out into one report job per vehicle per 31-day chunk.
    maxEventsPerFetch: Number.MAX_SAFE_INTEGER,
    async fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]> {
      const vehicles = await load();
      if (vehicles.length === 0) return [];
      return client.fetchPositions(from, to, vehicles);
    },
  };
}
