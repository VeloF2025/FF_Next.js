/**
 * The headline cards and the breakdown table (stage 8, task 9).
 *
 * Every figure here came from the server. The component divides nothing, sums
 * nothing across metric keys, and infers nothing from an absence — the three
 * things that would each turn a withheld figure into a confident zero.
 */
import type { OperationsMetricKey } from '../analytics/aggregateSchema';
import type { OperationsMetricValue } from '../analytics/types';
import { HEADLINE_METRICS, METRIC_GROUPS, metricLabel } from './operationsMetricLabels';

/** What a card says when the range reported the metric in no month at all. */
const NOT_REPORTED = 'Not reported';

function percentText(value: OperationsMetricValue): string | null {
  if (value.denominator === null || value.denominator === 0) return null;
  return `${Math.round((value.numerator / value.denominator) * 100)}%`;
}

/** `null` where the metric is genuinely absent, so a card can say so. */
function find(cards: readonly OperationsMetricValue[], key: OperationsMetricKey): OperationsMetricValue | null {
  return cards.find((card) => card.metricKey === key) ?? null;
}

function Coverage({ value }: { value: OperationsMetricValue }) {
  // Said only where it differs. Printing "3 of 3" on every card makes the one
  // card that says "1 of 3" invisible among them.
  if (value.coverage.months === value.coverage.of) return null;
  return (
    <p className="text-[10px] text-amber-400">
      {value.coverage.months} of {value.coverage.of} months reported this
    </p>
  );
}

function HeadlineCard({ metricKey, value }: { metricKey: OperationsMetricKey; value: OperationsMetricValue | null }) {
  const percent = value ? percentText(value) : null;
  return (
    <div
      data-testid={`operations-card-${metricKey}`}
      className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]"
    >
      <p className="text-xs text-[var(--ff-text-secondary)]">{metricLabel(metricKey)}</p>
      {value === null ? (
        <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">{NOT_REPORTED}</p>
      ) : (
        <>
          <p className="text-xl font-bold text-[var(--ff-text-primary)]">{percent ?? '—'}</p>
          <p className="text-[10px] text-[var(--ff-text-tertiary)]">
            {value.numerator}
            {value.denominator !== null && <> of {value.denominator}</>}
          </p>
          <Coverage value={value} />
        </>
      )}
    </div>
  );
}

function BreakdownRow({ value }: { value: OperationsMetricValue }) {
  const percent = percentText(value);
  const timing = value.metricKey.startsWith('timing.');
  return (
    <tr className="border-t border-[var(--ff-border-light)]">
      <td className="py-1.5 px-3 text-[var(--ff-text-primary)]">{metricLabel(value.metricKey)}</td>
      {/* A timing metric's numerator is a structural zero — the calculator
          observes a duration for it and never bumps a count — so the count
          column stays empty rather than reporting one. */}
      <td className="py-1.5 px-3 text-right text-[var(--ff-text-primary)]">{timing ? '' : value.numerator}</td>
      <td className="py-1.5 px-3 text-right text-[var(--ff-text-secondary)]">{value.denominator ?? ''}</td>
      <td className="py-1.5 px-3 text-right text-[var(--ff-text-secondary)]">{percent ?? ''}</td>
      <td className="py-1.5 px-3 text-right text-[var(--ff-text-tertiary)]">
        {value.histogram && value.histogram.sampleCount > 0
          ? `${value.histogram.sampleCount} samples`
          : ''}
      </td>
      <td className="py-1.5 px-3 text-right text-[var(--ff-text-tertiary)]">
        {value.coverage.months} of {value.coverage.of}
      </td>
    </tr>
  );
}

export interface OperationsOverviewProps {
  cards: readonly OperationsMetricValue[];
}

export function OperationsOverview({ cards }: OperationsOverviewProps) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {HEADLINE_METRICS.map((metricKey) => (
          <HeadlineCard key={metricKey} metricKey={metricKey} value={find(cards, metricKey)} />
        ))}
      </div>

      <div data-testid="operations-breakdown" className="space-y-4">
        {METRIC_GROUPS.map((group) => {
          // A group nothing reported is omitted rather than drawn as a table of
          // zeros. The suppression notices above say which months withheld what.
          const rows = group.keys.map((key) => find(cards, key)).filter((row): row is OperationsMetricValue => row !== null);
          if (rows.length === 0) return null;
          return (
            <div key={group.title}>
              <h4 className="text-xs font-semibold text-[var(--ff-primary)] mb-1 uppercase tracking-wide">{group.title}</h4>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[var(--ff-text-secondary)]">
                    <th className="py-1 px-3 text-left font-medium">Measure</th>
                    <th className="py-1 px-3 text-right font-medium">Count</th>
                    <th className="py-1 px-3 text-right font-medium">Out of</th>
                    <th className="py-1 px-3 text-right font-medium">Share</th>
                    <th className="py-1 px-3 text-right font-medium">Durations</th>
                    <th className="py-1 px-3 text-right font-medium">Months</th>
                  </tr>
                </thead>
                <tbody>{rows.map((row) => <BreakdownRow key={row.metricKey} value={row} />)}</tbody>
              </table>
            </div>
          );
        })}
      </div>
    </>
  );
}
