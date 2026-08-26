/**
 * Summary cards over a vehicle's stats window.
 *
 * Every total here is a PARTIAL total and says so. Ignition, moving and idle seconds are summed
 * only over the days whose feed could measure them, so a card built from 4 of 30 days prints
 * "4 of 30 days measurable" beside the number rather than presenting it as a month's driving.
 * Where no day in the window could measure a thing at all, the card shows an em dash and the
 * reason — never a zero, which would read as "this vehicle never ran".
 */
import type { VehicleDayStatsRow } from '../statsQueries';
import type { VehicleStatsCoverage } from './vehicleStatsApi';
import {
  SPEEDING_EVENTS_TITLE,
  UNMEASURABLE_TEXT,
  UNMEASURABLE_TITLE,
  formatDuration,
  formatKm,
  sumDistance,
  sumOverMeasurableDays,
} from './statsDisplay';

interface CardProps {
  label: string;
  value: string;
  hint?: string;
  title?: string;
  tone?: 'normal' | 'warning';
}

function StatCard({ label, value, hint, title, tone = 'normal' }: CardProps) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        tone === 'warning'
          ? 'border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-900/20'
          : 'border-[var(--ff-border-light)] bg-[var(--ff-surface-primary)]'
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-[var(--ff-text-secondary)]">{label}</p>
      <p
        className="mt-1 text-2xl font-semibold text-[var(--ff-text-primary)]"
        title={title}
        data-testid={`stat-value-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-[var(--ff-text-secondary)]">{hint}</p>}
    </div>
  );
}

export interface VehicleStatsCardsProps {
  days: VehicleDayStatsRow[];
  coverage: VehicleStatsCoverage;
  windowDays: number;
}

export default function VehicleStatsCards({ days, coverage, windowDays }: VehicleStatsCardsProps) {
  const distance = sumDistance(days);
  const ignition = sumOverMeasurableDays(days, 'ignitionSeconds');
  const moving = sumOverMeasurableDays(days, 'movingSeconds');
  const idle = sumOverMeasurableDays(days, 'idleSeconds');

  const harshObservable = days.some((d) => d.coverageGforce || d.coverageProviderEvents);
  const harshTotal = days.reduce(
    (acc, d) => acc + d.harshBrakeEvents + d.harshAccelEvents + d.harshCornerEvents, 0,
  );
  const speedingEvents = days.reduce((acc, d) => acc + d.speedingEvents, 0);

  const neverObserved = coverage.daysExpected === 0;
  const measurableHint = `${ignition.daysCounted} of ${ignition.daysConsidered} days measurable`;

  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
      data-testid="vehicle-stats-cards"
    >
      <StatCard
        label="Days observed"
        value={neverObserved ? 'Never observed' : `${coverage.daysWithData} / ${coverage.daysExpected}`}
        hint={
          neverObserved
            ? 'no position has ever been recorded for this vehicle'
            : `days with data / days expected since ${coverage.firstPositionWorkDate ?? 'the first fix'}`
        }
        title={neverObserved ? 'no position has ever been recorded for this vehicle' : undefined}
        tone={!neverObserved && coverage.daysWithData < coverage.daysExpected ? 'warning' : 'normal'}
      />

      <StatCard
        label="Partial days"
        value={String(coverage.daysPartial)}
        hint="observed, but with less evidence than the feed’s own standard requires"
        tone={coverage.daysPartial > 0 ? 'warning' : 'normal'}
      />

      <StatCard
        label="Distance"
        value={days.length === 0 ? UNMEASURABLE_TEXT : formatKm(distance.total)}
        hint={
          days.length === 0
            ? 'no day in this window was observed'
            : `over ${distance.daysCounted} of the last ${windowDays} days`
        }
        title={days.length === 0 ? UNMEASURABLE_TITLE : undefined}
      />

      <StatCard
        label="Ignition time"
        value={ignition.daysCounted === 0 ? UNMEASURABLE_TEXT : formatDuration(ignition.total)}
        hint={ignition.daysCounted === 0 ? UNMEASURABLE_TITLE : measurableHint}
        title={ignition.daysCounted === 0 ? UNMEASURABLE_TITLE : undefined}
      />

      <StatCard
        label="Moving time"
        value={moving.daysCounted === 0 ? UNMEASURABLE_TEXT : formatDuration(moving.total)}
        hint={moving.daysCounted === 0 ? UNMEASURABLE_TITLE : measurableHint}
        title={moving.daysCounted === 0 ? UNMEASURABLE_TITLE : undefined}
      />

      <StatCard
        label="Idle time"
        value={idle.daysCounted === 0 ? UNMEASURABLE_TEXT : formatDuration(idle.total)}
        hint={idle.daysCounted === 0 ? UNMEASURABLE_TITLE : measurableHint}
        title={idle.daysCounted === 0 ? UNMEASURABLE_TITLE : undefined}
      />

      <StatCard
        label="Speeding events"
        value={days.length === 0 ? UNMEASURABLE_TEXT : String(speedingEvents)}
        hint={days.length === 0 ? UNMEASURABLE_TITLE : SPEEDING_EVENTS_TITLE}
        title={days.length === 0 ? UNMEASURABLE_TITLE : SPEEDING_EVENTS_TITLE}
      />

      <StatCard
        label="Harsh driving"
        value={harshObservable ? String(harshTotal) : UNMEASURABLE_TEXT}
        hint={
          harshObservable
            ? 'braking, acceleration and cornering combined'
            : 'this feed reports neither g-force nor provider events'
        }
        title={harshObservable ? undefined : UNMEASURABLE_TITLE}
      />
    </div>
  );
}
