/**
 * Every tracked vehicle's row for one SAST day.
 *
 * A vehicle with no row for the day stays in the table as "No data" — it is the line worth
 * reading, and dropping it (or printing zeros for it) would turn a dead tracker into a quiet day.
 * Ignition, moving and idle columns show an em dash wherever the feed could not measure them.
 */
import Link from 'next/link';
import {
  COVERAGE_CLASS,
  COVERAGE_LABEL,
  COVERAGE_TITLE,
  coverageState,
  distanceValue,
  ignitionTimeValue,
  maxSpeedValue,
} from './statsDisplay';
import type { StatValue } from './statsDisplay';
import type { FleetOverviewResult } from './vehicleStatsApi';

function Cell({ value }: { value: StatValue }) {
  return (
    <td
      className={`px-3 py-2 text-right whitespace-nowrap ${
        value.kind === 'value'
          ? 'text-[var(--ff-text-primary)]'
          : 'text-[var(--ff-text-secondary)] italic'
      }`}
      title={value.title}
      data-state={value.kind}
    >
      {value.text}
    </td>
  );
}

export interface FleetStatsOverviewProps {
  result: FleetOverviewResult;
}

export default function FleetStatsOverview({ result }: FleetStatsOverviewProps) {
  const { coverage, vehicles, workDate } = result;

  return (
    <div className="space-y-3" data-testid="fleet-stats-overview">
      <p className="text-sm text-[var(--ff-text-secondary)]">
        {coverage.vehiclesWithData} of {coverage.trackedVehicles} tracked vehicles reported on{' '}
        {workDate}
        {coverage.vehiclesPartial > 0 && `; ${coverage.vehiclesPartial} only partially`}.
      </p>

      {vehicles.length === 0 && (
        <p className="rounded-lg border border-[var(--ff-border-light)] px-3 py-2 text-sm text-[var(--ff-text-secondary)]">
          No active vehicle carries a tracker, so there is nothing to report for {workDate}.
        </p>
      )}

      {vehicles.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--ff-border-light)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Vehicle</th>
                <th className="px-3 py-2 text-left font-medium">Coverage</th>
                <th className="px-3 py-2 text-right font-medium">Distance</th>
                <th className="px-3 py-2 text-right font-medium">Ignition</th>
                <th className="px-3 py-2 text-right font-medium">Moving</th>
                <th className="px-3 py-2 text-right font-medium">Max speed</th>
                <th className="px-3 py-2 text-right font-medium">Speeding events</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((vehicle) => {
                const row = vehicle.stats;
                const state = coverageState(row);
                return (
                  <tr
                    key={vehicle.vehicleId}
                    data-testid={`overview-row-${vehicle.vehicleId}`}
                    data-coverage={state}
                    className="border-t border-[var(--ff-border-light)]"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={`/fleet/vehicles/${vehicle.vehicleId}/stats`}
                        className="text-[var(--ff-primary)] hover:underline"
                      >
                        {vehicle.registration ?? vehicle.vehicleId}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${COVERAGE_CLASS[state]}`}
                        title={COVERAGE_TITLE[state]}
                      >
                        {COVERAGE_LABEL[state]}
                      </span>
                    </td>
                    <Cell value={distanceValue(row)} />
                    <Cell value={ignitionTimeValue(row, 'ignitionSeconds')} />
                    <Cell value={ignitionTimeValue(row, 'movingSeconds')} />
                    <Cell value={maxSpeedValue(row)} />
                    <Cell
                      value={
                        row === null
                          ? { kind: 'missing', text: 'No data', title: COVERAGE_TITLE.missing }
                          : { kind: 'value', text: String(row.speedingEvents) }
                      }
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
