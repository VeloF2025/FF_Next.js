/**
 * Persistence for monthly aggregates, and the coverage gate retention asks
 * before it deletes anything.
 *
 * A month is replaced whole or not at all. Every recalculation computes the
 * full set of rows for one (month, metric_version), compares their checksums to
 * what is stored, and either writes nothing or replaces the lot inside one
 * transaction. Writing nothing is the common case - a month three back rarely
 * changes - and it is the entire reason the checksum column exists: without it,
 * a nightly three-month window would rewrite every row every night.
 *
 * Rows are DELETEd and re-INSERTed rather than deactivated in place. Keeping a
 * superseded generation for every nightly run would grow this table by
 * `metrics x sites x runs` forever, and nothing reads a superseded row. What
 * `is_active` is genuinely for is the OTHER axis: when `metric_version` moves
 * on, the previous version's rows stay in place, deactivated, so a month that
 * fails to recalculate under the new definition still has a complete older
 * answer to fall back to.
 */
import { query, transaction } from '@/lib/db-pool';
import { checksumForAggregate } from './aggregateChecksum';
import { DURATION_BUCKET_COLUMNS } from './aggregateSchema';
import type { ReleasedAggregate } from './suppression';

interface ChecksumRow extends Record<string, unknown> {
  checksum: string | null;
}

interface CountRow extends Record<string, unknown> {
  row_count: string | number;
}

/** The stored active checksums for one (month, version), as a set. */
async function storedChecksums(monthStart: string, metricVersion: number): Promise<Set<string>> {
  const rows = await query<ChecksumRow>(
    `/* fleet-analytics-aggregates:checksums */
     SELECT checksum FROM fleet_operational_monthly_aggregates
     WHERE month_start = $1::date AND metric_version = $2 AND is_active = true`,
    [monthStart, metricVersion],
  );
  return new Set(rows.map((row) => row.checksum ?? ''));
}

/**
 * True when the stored set and the freshly computed set are the same rows.
 *
 * Compares both membership AND size, so a month that loses a row still counts
 * as changed - a subset would otherwise pass a membership-only check and the
 * removed row would survive forever.
 */
function isUnchanged(stored: Set<string>, computed: readonly string[]): boolean {
  if (stored.size !== computed.length) return false;
  return computed.every((checksum) => stored.has(checksum));
}

const INSERT_COLUMNS = [
  'metric_version', 'month_start', 'dimension_level', 'dimension_project_id', 'dimension_site_id',
  'generalized_from_level', 'metric_key', 'metric_kind', 'numerator', 'denominator',
  'sample_count', 'sum_seconds', ...DURATION_BUCKET_COLUMNS,
  'contributor_count', 'is_active', 'aggregation_run_id', 'checksum',
];

const INSERT_SQL = `/* fleet-analytics-aggregates:insert */
  INSERT INTO fleet_operational_monthly_aggregates (${INSERT_COLUMNS.join(', ')})
  VALUES (${INSERT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})`;

/**
 * The parameter row for one aggregate, in `INSERT_COLUMNS` order.
 *
 * The histogram columns are all-or-nothing: the migration's `histogram_pairing`
 * CHECK requires every bucket to be non-null for a timing metric and every one
 * of them to be null for anything else, so they are written from the histogram
 * or written as nulls, never partially.
 */
function insertParams(
  row: ReleasedAggregate,
  runId: string,
  checksum: string,
): unknown[] {
  const buckets = row.histogram
    ? DURATION_BUCKET_COLUMNS.map((_, i) => row.histogram?.buckets[i] ?? 0)
    : DURATION_BUCKET_COLUMNS.map(() => null);
  return [
    row.metricVersion, row.monthStart, row.dimensionLevel, row.dimensionProjectId, row.dimensionSiteId,
    row.generalizedFromLevel, row.metricKey, row.metricKind, row.numerator, row.denominator,
    row.histogram?.sampleCount ?? null, row.histogram?.sumSeconds ?? null, ...buckets,
    row.contributorCount, true, runId, checksum,
  ];
}

export interface ReplaceMonthResult {
  changed: boolean;
  rowsWritten: number;
}

/**
 * Replaces one month at one metric version, or leaves it untouched when nothing
 * changed.
 *
 * The delete and every insert share one transaction, so a month is never
 * observable half-written - a reader either sees the previous complete answer
 * or the new one.
 */
export async function replaceMonth(
  monthStart: string,
  metricVersion: number,
  rows: readonly ReleasedAggregate[],
  runId: string,
): Promise<ReplaceMonthResult> {
  const checksums = rows.map((row) => checksumForAggregate(row));
  const stored = await storedChecksums(monthStart, metricVersion);
  if (isUnchanged(stored, checksums)) return { changed: false, rowsWritten: 0 };

  await transaction(async (client) => {
    await client.query(
      `/* fleet-analytics-aggregates:clear */
       DELETE FROM fleet_operational_monthly_aggregates
       WHERE month_start = $1::date AND metric_version = $2`,
      [monthStart, metricVersion],
    );
    for (const [index, row] of rows.entries()) {
      await client.query(INSERT_SQL, insertParams(row, runId, checksums[index] ?? ''));
    }
    // Only once this version's rows are in place: retire the other versions of
    // this month, so a failure above leaves the older answer active.
    await client.query(
      `/* fleet-analytics-aggregates:retire-other-versions */
       UPDATE fleet_operational_monthly_aggregates SET is_active = false, updated_at = now()
       WHERE month_start = $1::date AND metric_version <> $2 AND is_active = true`,
      [monthStart, metricVersion],
    );
  });

  return { changed: true, rowsWritten: rows.length };
}

/**
 * Whether retention may treat this month as aggregated.
 *
 * KNOWN LIMITATION, and deliberately left failing closed: a month whose data
 * was entirely suppressed - every group under the anonymity threshold, or every
 * incident missing an operational site - stores no rows, so this reports false
 * and its incidents are never purged. Blocking a deletion is the safe direction
 * to be wrong in, but it does mean such a month needs a manual decision. Fixing
 * it properly needs a per-month run record, which is a migration and therefore
 * its own approval.
 */
export async function hasCompleteAggregateCoverage(
  monthStart: string,
  metricVersion: number,
): Promise<boolean> {
  const rows = await query<CountRow>(
    `/* fleet-analytics-aggregates:coverage */
     SELECT count(*) AS row_count FROM fleet_operational_monthly_aggregates
     WHERE month_start = $1::date AND metric_version = $2 AND is_active = true`,
    [monthStart, metricVersion],
  );
  return Number(rows[0]?.row_count ?? 0) > 0;
}
