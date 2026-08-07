/**
 * The Cartrack fleetweb portal as a TrackingProvider.
 *
 * Reports `key: 'cartrack'` with a distinct accountRef, because the data IS
 * Cartrack data — only the transport differs from the REST provider. Tracker
 * uniqueness is (provider, account_ref, external_id), so cartrack/velocity and
 * cartrack/urent coexist without collision, and discovery's
 * already-tracked-elsewhere guard keeps them from stealing each other's vehicles.
 */
import {
  cartrackPortalClient,
  type CartrackPortalClient,
  type CartrackPortalOptions,
} from './portalClient';
import type { ProviderPosition, TrackingProvider } from '../types';

export type CartrackPortalProviderOptions =
  | ({ accountRef: string; client: CartrackPortalClient } & Partial<CartrackPortalOptions>)
  | ({ accountRef: string; client?: undefined } & CartrackPortalOptions);

export function cartrackPortalProvider(
  opts: CartrackPortalProviderOptions
): TrackingProvider {
  const client = opts.client ?? cartrackPortalClient(opts as CartrackPortalOptions);

  return {
    key: 'cartrack',
    accountRef: opts.accountRef,
    // One current fix per vehicle — never a track. This account holds vehicles
    // whose last fix is days old, so an unchanged result means "parked", not
    // "feed dead".
    granularity: 'snapshot',
    // Bounded by fleet size, not event volume: no page to blow, no window to
    // size, so opt out of the event-budget clamp.
    maxEventsPerFetch: Number.MAX_SAFE_INTEGER,
    fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]> {
      return client.fetchPositions(from, to);
    },
  };
}
