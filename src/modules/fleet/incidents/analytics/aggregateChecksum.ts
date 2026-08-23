/**
 * The content digest stored on every aggregate row.
 *
 * Its job is to answer one question cheaply: did recalculating this month
 * change anything? A month is recalculated on every run inside the window, and
 * without a digest the only way to know whether the numbers moved is to
 * re-derive and compare them field by field.
 *
 * It is computed from a fixed field order rather than from `JSON.stringify` of
 * the row, because object key order is an accident of construction and a
 * refactor that reorders a literal must not silently invalidate every stored
 * checksum. Anything not listed here is not part of a row's content: `id`,
 * `is_active`, `aggregation_run_id`, and the timestamps all change without the
 * numbers changing.
 *
 * The output shape is pinned by the migration's `checksum_shape` CHECK - a
 * lowercase sha256 hex digest and nothing else fits the column.
 */
import { createHash } from 'crypto';
import type { ReleasedAggregate } from './suppression';

/** Field order is part of the contract; changing it changes every checksum. */
function canonicalize(row: ReleasedAggregate): string {
  return [
    row.metricVersion,
    row.monthStart,
    row.dimensionLevel,
    row.dimensionProjectId ?? '',
    row.dimensionSiteId ?? '',
    row.generalizedFromLevel ?? '',
    row.metricKey,
    row.metricKind,
    row.numerator,
    row.denominator ?? '',
    row.histogram ? row.histogram.sampleCount : '',
    row.histogram ? row.histogram.sumSeconds : '',
    row.histogram ? row.histogram.buckets.join(',') : '',
    row.contributorCount,
    // A separator, so that (numerator 1, denominator 2) cannot collide with
    // (numerator 12, denominator absent). No field's value can contain it: ids
    // are UUIDs, and keys and levels come from closed lowercase value sets.
  ].join('|');
}

/** Lowercase sha256 hex digest of the row's content fields. */
export function checksumForAggregate(row: ReleasedAggregate): string {
  return createHash('sha256').update(canonicalize(row), 'utf8').digest('hex');
}
