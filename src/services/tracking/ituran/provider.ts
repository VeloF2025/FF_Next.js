/**
 * Ituran as a TrackingProvider.
 *
 * Unlike Netstar's reseller tree, this account carries only our own vehicles,
 * so the grid is requested whole and reconciled against fleet_vehicles rather
 * than filtered to a pre-mapped list.
 */
import { ituranClient, type IturanClient, type IturanClientOptions } from './client';
import type { ProviderPosition, TrackingProvider } from '../types';

/**
 * Either hand over a ready client, or the ingredients to build one — never
 * both. Extending IturanClientOptions unconditionally would force every caller
 * that already has a client to also wire up a mintSession closure that is then
 * never called.
 */
export type IturanProviderOptions =
  | ({ accountRef: string; client: IturanClient } & Partial<IturanClientOptions>)
  | ({ accountRef: string; client?: undefined } & IturanClientOptions);

export function ituranProvider(opts: IturanProviderOptions): TrackingProvider {
  const client = opts.client ?? ituranClient(opts as IturanClientOptions);

  return {
    key: 'ituran',
    accountRef: opts.accountRef,
    // One current fix per vehicle — never a track. A window returns at most
    // one point per vehicle however wide it is, and an unmoved vehicle returns
    // the same fix indefinitely, so an empty result never means "feed dead".
    granularity: 'snapshot',
    // Bounded by fleet size, not event volume: there is no page to blow and no
    // window to size, so opt out of the event-budget clamp entirely.
    maxEventsPerFetch: Number.MAX_SAFE_INTEGER,
    fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]> {
      return client.fetchPositions(from, to);
    },
  };
}
