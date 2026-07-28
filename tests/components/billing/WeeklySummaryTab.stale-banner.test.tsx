/**
 * The stale-week banner makes a claim about the metric cards beneath it, and
 * that claim has to stay true as the cards change.
 *
 * Specifically it must NOT say the cards "exclude" the stale projects:
 *   - Currently Excluded DOES omit them (no row in the latest week group)
 *   - Recovered This Month INCLUDES them, computed from their older week
 *     (/api/billing/status sums `totals` over every project unconditionally)
 *   - PP Outstanding INCLUDES them and isn't week-anchored at all — it reads
 *     live from oes_pp_data
 * So the honest scope is "anchored to the latest billing week", not "exclude".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WeeklySummaryTab } from '@/modules/billing/components/WeeklySummaryTab';

vi.mock('next/router', () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), replace: vi.fn(), isReady: true }),
}));
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const STALE_STATUS = {
  data: {
    projects: [],
    newest_week_ending: '2026-07-26',
    stale: [
      { project: 'Thembisa POP 3', latest_week_ending: '2026-07-19', weeks_behind: 1 },
    ],
    totals: { currently_excluded: 5, pp_outstanding: 12, recovered_this_month: 3 },
  },
};

function stubFetch(status: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (String(url).includes('/api/billing/status')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(status) });
      }
      // weekly rows + billable projects — empty is fine, the banner is driven
      // entirely by the status payload.
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    }),
  );
}

describe('WeeklySummaryTab — stale-week banner', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('names the stale project and how far behind it is', async () => {
    stubFetch(STALE_STATUS);
    render(<WeeklySummaryTab />);

    const banner = await screen.findByText(/behind the latest billing week/i);
    expect(banner).toBeTruthy();
    expect(await screen.findByText(/Thembisa POP 3/)).toBeTruthy();
    expect(await screen.findByText(/2026-07-19/)).toBeTruthy();
    expect(await screen.findByText(/1 week.*behind/i)).toBeTruthy();
  });

  it('does NOT claim the metric cards exclude the stale projects', async () => {
    stubFetch(STALE_STATUS);
    render(<WeeklySummaryTab />);

    await screen.findByText(/behind the latest billing week/i);

    // Two of the three cards read from `totals`, which sums every project —
    // so an "exclude" claim would be false. Scope must be the weaker,
    // accurate one.
    expect(screen.queryByText(/metrics below exclude these projects/i)).toBeNull();
    expect(
      screen.getByText(/anchored to the latest billing week is incomplete or out of date/i),
    ).toBeTruthy();
  });

  it('renders no banner when every project is current', async () => {
    stubFetch({ data: { ...STALE_STATUS.data, stale: [] } });
    render(<WeeklySummaryTab />);

    await waitFor(() => {
      expect(screen.queryByText(/behind the latest billing week/i)).toBeNull();
    });
  });
});
