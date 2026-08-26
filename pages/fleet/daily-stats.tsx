/**
 * Fleet-wide vehicle-day statistics for one SAST day.
 *
 * Defaults to yesterday: today's fold has only seen the hours that have happened, so every
 * vehicle would read as partially covered until midnight.
 */
import { useEffect, useState } from 'react';
import Head from 'next/head';
import { Loader2 } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import FleetStatsOverview from '@/modules/fleet/dailyStats/web/FleetStatsOverview';
import { fetchFleetDayOverview } from '@/modules/fleet/dailyStats/web/vehicleStatsApi';
import type { FleetOverviewResult } from '@/modules/fleet/dailyStats/web/vehicleStatsApi';

export default function FleetDailyStatsPage() {
  const [date, setDate] = useState<string>('');
  const [result, setResult] = useState<FleetOverviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    // An empty `date` lets the API pick yesterday in SAST — the browser's own clock is not the
    // authority on what "yesterday" is for a South African fleet.
    fetchFleetDayOverview({ date: date === '' ? undefined : date, signal: controller.signal })
      .then((data) => { setResult(data); setLoading(false); })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load fleet statistics');
        setLoading(false);
      });
    return () => controller.abort();
  }, [date]);

  return (
    <AppLayout>
      <Head><title>Fleet day statistics | FibreFlow</title></Head>
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Fleet day statistics</h1>
            <p className="text-[var(--ff-text-secondary)]">
              Every tracked vehicle for one SAST day. A vehicle with no row was never observed.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
            Day
            <input
              type="date"
              value={date === '' ? result?.workDate ?? '' : date}
              onChange={(event) => setDate(event.target.value)}
              className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-surface-primary)] px-2 py-1 text-[var(--ff-text-primary)]"
            />
          </label>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-[var(--ff-text-secondary)]">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading fleet statistics…
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
          >
            {error}
          </p>
        )}

        {result && !loading && <FleetStatsOverview result={result} />}
      </div>
    </AppLayout>
  );
}
