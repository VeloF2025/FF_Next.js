/**
 * One row per SAST day in the window — including the days that have no row.
 *
 * The API returns only stored days; this table fills the gaps with an explicit "No data" state so
 * a dead tracker reads as a dead tracker rather than as a short month. Nothing here ever prints a
 * zero it was not given: every cell goes through `statsDisplay`, which returns an em dash and a
 * reason wherever the feed could not measure the thing.
 */
import type { VehicleDayStatsRow } from '../statsQueries';
import type { VehicleStatsToday } from './vehicleStatsApi';
import {
  IGNITION_WINDOW_TITLE,
  SILENCE_TITLE,
  COVERAGE_CLASS,
  COVERAGE_LABEL,
  COVERAGE_TITLE,
  coverageState,
  datesInWindow,
  distanceValue,
  harshValue,
  ignitionTimeValue,
  ignitionWindowValue,
  maxSpeedValue,
  speedingSecondsValue,
  trackerSilenceValue,
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

interface DayRowProps {
  label: string;
  row: VehicleDayStatsRow | null;
  testId: string;
  selected?: boolean;
  onSelect?: () => void;
  /**
   * A day still running. Its coverage is not judged: `coverage_complete = false` on the current
   * day means "the day is not over", which says nothing about the tracker.
   */
  inProgress?: boolean;
}

function DayRow({ label, row, testId, selected, onSelect, inProgress }: DayRowProps) {
  const state = coverageState(row);
  const harshCount = row === null
    ? 0
    : row.harshBrakeEvents + row.harshAccelEvents + row.harshCornerEvents;
  return (
    <tr
      data-testid={testId}
      data-coverage={inProgress ? 'in_progress' : state}
      onClick={onSelect}
      className={`border-t border-[var(--ff-border-light)] ${
        onSelect ? 'cursor-pointer hover:bg-[var(--ff-bg-tertiary)]' : ''
      } ${selected ? 'bg-[var(--ff-bg-tertiary)]' : ''} ${
        inProgress ? 'bg-[var(--ff-bg-tertiary)]/60 italic' : ''
      }`}
    >
      <td className="px-3 py-2 whitespace-nowrap text-[var(--ff-text-primary)]">{label}</td>
      <td className="px-3 py-2">
        {inProgress ? (
          <span
            className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
            title="the day is not over — its coverage is not judged yet"
          >
            In progress
          </span>
        ) : (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${COVERAGE_CLASS[state]}`}
            title={COVERAGE_TITLE[state]}
          >
            {COVERAGE_LABEL[state]}
          </span>
        )}
      </td>
      <Cell value={distanceValue(row)} />
      <Cell value={ignitionTimeValue(row, 'ignitionSeconds')} />
      <Cell value={ignitionTimeValue(row, 'movingSeconds')} />
      <Cell value={ignitionTimeValue(row, 'idleSeconds')} />
      <Cell value={maxSpeedValue(row)} />
      <Cell value={speedingSecondsValue(row)} />
      <Cell value={harshValue(row, harshCount)} />
      <Cell value={trackerSilenceValue(row)} />
      <Cell value={ignitionWindowValue(row)} />
    </tr>
  );
}

export interface VehicleStatsTableProps {
  days: VehicleDayStatsRow[];
  startWorkDate: string;
  endWorkDate: string;
  selectedDate?: string | null;
  onSelectDate?: (workDate: string) => void;
  /** The day still running. Rendered above the window, never inside it. */
  today?: VehicleStatsToday | null;
}

export default function VehicleStatsTable({
  days, startWorkDate, endWorkDate, selectedDate, onSelectDate, today,
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
            <th className="px-3 py-2 text-right font-medium">Speeding time</th>
            <th className="px-3 py-2 text-right font-medium">Harsh</th>
            <th className="px-3 py-2 text-right font-medium" title={SILENCE_TITLE}>
              Longest silence
            </th>
            <th className="px-3 py-2 text-right font-medium" title={IGNITION_WINDOW_TITLE}>
              Ignition window
            </th>
          </tr>
        </thead>
        <tbody>
          {today && (
            <DayRow
              inProgress
              label={`${today.workDate} — Today (in progress)`}
              row={today.stats}
              testId={`stats-row-today-${today.workDate}`}
            />
          )}
          {dates.map((date) => (
            <DayRow
              key={date}
              label={date}
              onSelect={onSelectDate ? () => onSelectDate(date) : undefined}
              row={byDate.get(date) ?? null}
              selected={selectedDate === date}
              testId={`stats-row-${date}`}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
