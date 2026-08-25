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
    null, row.metricKey, row.metricKind, row.numerator, row.denominator,
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
  const changed = !isUnchanged(stored, checksums);

  await transaction(async (client) => {
    if (changed) {
      await client.query(
        `/* fleet-analytics-aggregates:clear */
         DELETE FROM fleet_operational_monthly_aggregates
         WHERE month_start = $1::date AND metric_version = $2`,
        [monthStart, metricVersion],
      );
      for (const [index, row] of rows.entries()) {
        await client.query(INSERT_SQL, insertParams(row, runId, checksums[index] ?? ''));
      }
    }
    // ALWAYS, even when this version's rows did not change - including when
    // this version publishes NOTHING. Tightening the anonymity policy is
    // exactly the case that recomputes to an empty set: `stored` is empty,
    // `rows` is empty, the two compare equal, and an early return here would
    // leave the LOOSER previous version's rows active forever. A retraction
    // that only runs when there is something to replace is not a retraction.
    // Sequenced after the insert so a failure above leaves the older answer
    // active rather than leaving the month with nothing.
    await client.query(
      `/* fleet-analytics-aggregates:retire-other-versions */
       UPDATE fleet_operational_monthly_aggregates SET is_active = false, updated_at = now()
       WHERE month_start = $1::date AND metric_version <> $2 AND is_active = true`,
      [monthStart, metricVersion],
    );

    // Coverage is recorded HERE, in the same transaction as the rows it
    // attests to (migration 530). A separate write after the fact could commit
    // while the rows did not, and the consequence of that particular lie is
    // retention deleting identifiable detail against an aggregate that was
    // never written.
    //
    // Written on every path, exactly like the retirement above: a month that
    // publishes NOTHING is still a month that was aggregated. That is the whole
    // defect this closes — the old gate counted published rows, so a month
    // whose every group fell below the anonymity threshold, or in which nothing
    // qualifying happened, reported no coverage forever and was never purged.
    //
    // Upserted because the nightly job re-aggregates the whole recalculation
    // window, so this key is rewritten every night; the run and timestamp name
    // the LATEST run to have covered the month, not the first.
    await client.query(
      `/* fleet-analytics-aggregates:record-coverage */
       INSERT INTO fleet_operational_aggregate_month_coverage
         (metric_version, month_start, aggregation_run_id, row_count, completed_at)
       VALUES ($1, $2::date, $3, $4, now())
       ON CONFLICT (metric_version, month_start) DO UPDATE
         SET aggregation_run_id = EXCLUDED.aggregation_run_id,
             row_count = EXCLUDED.row_count,
             completed_at = EXCLUDED.completed_at`,
      [metricVersion, monthStart, runId, rows.length],
    );
  });

  return { changed, rowsWritten: changed ? rows.length : 0 };
}

/**
 * NOTE: there is deliberately NO coverage query here.
 *
 * Retention's gate lives in `../retention/retentionRepository.ts`
 * (`hasCompleteAggregateCoverage`) and is the only one. An earlier version of
 * this file carried a second, identical implementation that nothing in
 * production called - two implementations of a gate that authorises deletion
 * is exactly the pair that drifts apart, and the one with no caller is the one
 * that drifts silently.
 *
 * That gate infers "this month was aggregated" from "this month stored rows",
 * which are not the same thing: a month whose every metric was withheld stores
 * nothing and so reports no coverage, and is never purged. Failing closed is
 * the right direction for a deletion gate but it is not a working retention
 * path. See `.claude/modules/fleet-analytics-disclosure.md`.
 */
