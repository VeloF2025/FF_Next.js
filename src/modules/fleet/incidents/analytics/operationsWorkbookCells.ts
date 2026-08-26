/**
 * Turning one `OperationsMetricValue` into cells — the arithmetic and wording
 * the export does that the JSON response does not.
 *
 * Pure: no ExcelJS, no SQL, no clock. Every function here exists because a
 * spreadsheet has one rendering for three different answers — a zero, a figure
 * that was withheld, and a figure that is no longer held all look like a quiet
 * cell — and only the code writing the cell can tell them apart.
 */
import { DURATION_BUCKET_BOUNDS, DURATION_BUCKET_COLUMNS } from './aggregateSchema';
import type { DurationHistogram, MetricCoverage, OperationsMetricValue } from './types';

/**
 * What a timing cell says when the durations behind it were purged.
 *
 * Migration 527's view publishes no histogram column, so a month read from the
 * aggregates has counts and no durations. Zero samples would claim no duration
 * was ever measured, and an empty cell would be indistinguishable from a metric
 * that has no duration at all.
 */
export const NOT_RETAINED = 'not retained';

/** What a month that published nothing says, in place of a row of blanks. */
export const NO_FIGURES = 'No figures for this month';

/** What an export whose filters matched nothing says, in place of bare headings. */
export const NO_FIGURES_AT_ALL =
  'No figures matched these filters. This is not a count of zero — see the Metadata sheet for the '
  + 'filters applied and for anything the published aggregates withheld.';

/** The four characters a spreadsheet reads as the start of a formula. */
const FORMULA_STARTS = ['=', '+', '-', '@'];

/**
 * A string that cannot be evaluated when the file is opened, or re-opened as
 * CSV.
 *
 * Nothing reaching this today can begin with one of those characters — the
 * filter parser validates against closed sets and formats, and every notice is
 * built from month dates and metric names. The guard is here because that is a
 * property of code upstream, not of this function's input, and a formula cell
 * is not the kind of thing to discover in a file someone has already opened.
 */
export function safeText(value: string): string {
  const dangerous = FORMULA_STARTS.some((start) => value.startsWith(start))
    || /^[\t\r\n]/.test(value);
  return dangerous ? `'${value}` : value;
}

/**
 * The bucket boundaries as reader-facing labels, derived from the bounds rather
 * than written out beside them — a hardcoded list is a list that survives a
 * change to `DURATION_BUCKET_BOUNDS` and then lies about it.
 *
 * Minutes throughout, including the four-hour bucket. Mixing units across
 * neighbouring labels ("30–60 min" then "1–4 hours") makes two adjacent rows
 * look like they measure different things.
 */
export function bucketLabels(): string[] {
  const minutes = DURATION_BUCKET_BOUNDS.map((seconds) => Math.round(seconds / 60));
  return DURATION_BUCKET_COLUMNS.map((_column, index) => {
    const upper = minutes[index];
    if (upper === undefined) return `over ${minutes[minutes.length - 1]} min`;
    const lower = index === 0 ? null : minutes[index - 1];
    return lower === null ? `up to ${upper} min` : `${lower}–${upper} min`;
  });
}

/** The ratio itself, for a cell carrying a percent number format. */
export function percentage(numerator: number, denominator: number | null): number | null {
  // A zero denominator is not a zero percentage. It is a population nobody was
  // drawn from, and dividing anyway produces either a crash or a confident 0%.
  if (denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

export function averageSeconds(histogram: DurationHistogram): number | null {
  if (histogram.sampleCount === 0) return null;
  return Math.round(histogram.sumSeconds / histogram.sampleCount);
}

/**
 * The bucket the middle sample falls in, named — not a median interpolated
 * inside it.
 *
 * Bucket counts cannot support a figure like "17 min 30 s", and one produced
 * from them would be read as a measurement. The bucket is what the data
 * actually says.
 */
export function medianBucket(histogram: DurationHistogram): string | null {
  if (histogram.sampleCount === 0) return null;
  const labels = bucketLabels();
  const middle = histogram.sampleCount / 2;
  let seen = 0;
  for (const [index, count] of histogram.buckets.entries()) {
    seen += count;
    if (seen >= middle) return labels[index] ?? null;
  }
  return null;
}

export function coverageText(coverage: MetricCoverage): string {
  return `${coverage.months} of ${coverage.of}`;
}

/**
 * The six figure cells for one metric, in column order:
 * count, out of, percentage, samples, average seconds, median bucket.
 *
 * A `timing.*` metric has no count by construction — the calculator observes a
 * duration for it and never bumps a tally — so its numerator is a structural
 * zero and is left out rather than printed as one. Everything else has no
 * duration, and leaves the three timing cells empty.
 */
export function figureCells(value: OperationsMetricValue): (number | string | null)[] {
  if (value.metricKey.startsWith('timing.')) {
    if (value.histogram === null) return [null, null, null, NOT_RETAINED, NOT_RETAINED, NOT_RETAINED];
    return [
      null, null, null,
      value.histogram.sampleCount,
      averageSeconds(value.histogram),
      medianBucket(value.histogram),
    ];
  }
  return [
    value.numerator,
    value.denominator,
    percentage(value.numerator, value.denominator),
    null, null, null,
  ];
}
