/**
 * Fetching that tolerates a partial result.
 *
 * Split from the poll loop because it encodes one provider's contract (only the
 * history path can raise PartialFetchError), not the loop's own logic.
 */
import { log } from '@/lib/logger';
import { PartialFetchError } from '@/services/tracking/netstar/client';
import type { ProviderPosition, TrackingProvider } from '@/services/tracking/types';

/**
 * Fetch, tolerating a partial result. The positions that arrived are worth
 * storing, but the window was not fully covered — so the caller must NOT
 * advance the watermark past it, or the vehicles that failed lose it for good.
 * `complete: false` carries that. (Only the history path can produce one.)
 */
export async function fetchTolerantly(
  provider: TrackingProvider, from: Date, to: Date
): Promise<{ positions: ProviderPosition[]; complete: boolean; detail: string | null }> {
  try {
    return { positions: await provider.fetchPositions(from, to), complete: true, detail: null };
  } catch (err) {
    if (err instanceof PartialFetchError) {
      log.warn('[poll-portal-tracking] partial fetch — storing what arrived, holding the watermark', {
        provider: provider.key, accountRef: provider.accountRef,
        recovered: err.positions.length, failures: err.failures,
      });
      return { positions: err.positions, complete: false, detail: err.message };
    }
    throw err;
  }
}
