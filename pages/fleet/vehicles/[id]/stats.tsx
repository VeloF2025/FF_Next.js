/**
 * Per-vehicle telematics day statistics.
 *
 * A sibling route of the 4,494-line `pages/fleet/vehicles/[id].tsx`, in the shape
 * `check-in-history.tsx` already proved works here — that page gains one link and nothing else.
 *
 * Everything on this page is rendered through `dailyStats/web/statsDisplay`, which is where the
 * "an unmeasurable statistic is never a zero" rule lives.
 */
import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import VehicleDayRouteMap from '@/modules/fleet/dailyStats/web/VehicleDayRouteMap';
import VehicleStatsCards from '@/modules/fleet/dailyStats/web/VehicleStatsCards';
import VehicleStatsTable from '@/modules/fleet/dailyStats/web/VehicleStatsTable';
import {
  fetchVehicleDailyStats,
  fetchVehicleDayRoute,
} from '@/modules/fleet/dailyStats/web/vehicleStatsApi';
import type {
  DayRouteResult, VehicleDailyStatsResult,
} from '@/modules/fleet/dailyStats/web/vehicleStatsApi';

const WINDOW_DAYS = 30;

export default function VehicleStatsPage() {
  const router = useRouter();
  const vehicleId = typeof router.query.id === 'string' ? router.query.id : null;

  const [result, setResult] = useState<VehicleDailyStatsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [route, setRoute] = useState<DayRouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [withPositions, setWithPositions] = useState(false);

  useEffect(() => {
    if (!vehicleId) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchVehicleDailyStats(vehicleId, { days: WINDOW_DAYS, signal: controller.signal })
      .then((data) => { setResult(data); setLoading(false); })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load statistics');
        setLoading(false);
      });
    return () => controller.abort();
  }, [vehicleId]);

  useEffect(() => {
    if (!vehicleId || selectedDate === null) return undefined;
    const controller = new AbortController();
    setRouteError(null);
    fetchVehicleDayRoute(vehicleId, selectedDate, {
      includePositions: withPositions, signal: controller.signal,
    })
      .then(setRoute)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setRouteError(err instanceof Error ? err.message : 'Could not load the route');
      });
    return () => controller.abort();
  }, [vehicleId, selectedDate, withPositions]);

  const selectDate = useCallback((date: string) => {
    setSelectedDate(date);
    setRoute(null);
    setWithPositions(false);
  }, []);

  return (
    <AppLayout>
      <Head><title>Vehicle statistics | FibreFlow</title></Head>
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-4">
          <Link href={vehicleId ? `/fleet/vehicles/${vehicleId}` : '/fleet/vehicles'}>
            <button
              type="button"
              aria-label="Back to vehicle"
              className="rounded-lg p-2 transition-colors hover:bg-[var(--ff-bg-tertiary)]"
            >
              <ArrowLeft className="h-5 w-5 text-[var(--ff-text-secondary)]" />
            </button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
              {result?.vehicle.registration ?? 'Vehicle'} — day statistics
            </h1>
            <p className="text-[var(--ff-text-secondary)]">
              Last {WINDOW_DAYS} days, SAST. A day with no row was never observed — it is not a day
              of zeros.
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-[var(--ff-text-secondary)]">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading statistics…
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

        {result && !loading && (
          <>
            <VehicleStatsCards
              coverage={result.coverage}
              days={result.days}
              windowDays={result.window.days}
            />
            <VehicleStatsTable
              days={result.days}
              endWorkDate={result.window.endWorkDate}
              onSelectDate={selectDate}
              selectedDate={selectedDate}
              startWorkDate={result.window.startWorkDate}
            />
            {selectedDate === null && (
              <p className="text-sm text-[var(--ff-text-secondary)]">
                Select a day above to draw its route.
              </p>
            )}
            {routeError && (
              <p
                role="alert"
                className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
              >
                {routeError}
              </p>
            )}
            {selectedDate !== null && route && (
              <VehicleDayRouteMap
                allTripsTimedOut={route.allTripsTimedOut}
                onRequestPositions={() => setWithPositions(true)}
                positions={route.positions}
                timedOutTrips={route.timedOutTrips}
                trips={route.trips}
                workDate={route.workDate}
              />
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
