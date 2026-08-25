/**
 * One row per SAST day in the window — including the days that have no row.
 *
 * The API returns only stored days; this table fills the gaps with an explicit "No data" state so
 * a dead tracker reads as a dead tracker rather than as a short month. Nothing here ever prints a
 * zero it was not given: every cell goes through `statsDisplay`, which returns an em dash and a
 * reason wherever the feed could not measure the thing.
 */
import type { VehicleDayStatsRow } from '../statsQueries';
import {
  COVERAGE_CLASS,
  COVERAGE_LABEL,
  COVERAGE_TITLE,
  coverageState,
  datesInWindow,
  distanceValue,
  harshValue,
  ignitionTimeValue,
  maxSpeedValue,
  speedingSecondsValue,
} from './statsDisplay';
import type { StatValue } from './statsDisplay';

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

export interface VehicleStatsTableProps {
  days: VehicleDayStatsRow[];
  startWorkDate: string;
  endWorkDate: string;
  selectedDate?: string | null;
  onSelectDate?: (workDate: string) => void;
}

export default function VehicleStatsTable({
  days, startWorkDate, endWorkDate, selectedDate, onSelectDate,
}: VehicleStatsTableProps) {
  const byDate = new Map(days.map((d) => [d.workDate, d]));
  // Newest first: the question a fleet manager opens this page with is "what happened yesterday".
  const dates = datesInWindow(startWorkDate, endWorkDate).reverse();

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--ff-border-light)]">
      <table className="min-w-full text-sm" data-testid="vehicle-stats-table">
        <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Day</th>
            <th className="px-3 py-2 text-left font-medium">Coverage</th>
            <th className="px-3 py-2 text-right font-medium">Distance</th>
            <th className="px-3 py-2 text-right font-medium">Ignition</th>
            <th className="px-3 py-2 text-right font-medium">Moving</th>
            <th className="px-3 py-2 text-right font-medium">Idle</th>
            <th className="px-3 py-2 text-right font-medium">Max speed</th>
            <th className="px-3 py-2 text-right font-medium">Speeding</th>
            <th className="px-3 py-2 text-right font-medium">Harsh</th>
          </tr>
        </thead>
        <tbody>
          {dates.map((date) => {
            const row = byDate.get(date) ?? null;
            const state = coverageState(row);
            const harshCount = row === null
              ? 0
              : row.harshBrakeEvents + row.harshAccelEvents + row.harshCornerEvents;
            return (
              <tr
                key={date}
                data-testid={`stats-row-${date}`}
                data-coverage={state}
                onClick={onSelectDate ? () => onSelectDate(date) : undefined}
                className={`border-t border-[var(--ff-border-light)] ${
                  onSelectDate ? 'cursor-pointer hover:bg-[var(--ff-bg-tertiary)]' : ''
                } ${selectedDate === date ? 'bg-[var(--ff-bg-tertiary)]' : ''}`}
              >
                <td className="px-3 py-2 whitespace-nowrap text-[var(--ff-text-primary)]">{date}</td>
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
                <Cell value={ignitionTimeValue(row, 'idleSeconds')} />
                <Cell value={maxSpeedValue(row)} />
                <Cell value={speedingSecondsValue(row)} />
                <Cell value={harshValue(row, harshCount)} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
