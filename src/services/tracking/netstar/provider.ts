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

/**
 * The vehicles this account has already mapped in fleet_vehicle_trackers.
 *
 * Exported because the backfill script needs the same list to drive the
 * history path, and duplicating the query there is how the two drift apart.
 */
export async function mappedVehicles(accountRef: string): Promise<PortalVehicle[]> {
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
    granularity: 'snapshot',
    // The tree API returns one fix per vehicle, so a fetch is bounded by fleet
    // size rather than by event volume — there is no page to blow and no window
    // to size. MAX_SAFE_INTEGER opts out of the budget clamp entirely.
    maxEventsPerFetch: Number.MAX_SAFE_INTEGER,
    async fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]> {
      const vehicles = await load();
      if (vehicles.length === 0) return [];
      return client.fetchPositions(from, to, vehicles);
    },
  };
}
