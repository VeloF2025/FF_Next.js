/**
 * Bounded per-source reads for the scoped incident chronology (stage 8, task 6).
 *
 * There is no timeline table and there never will be one — see the
 * `keeps TimelineSource out of the schema` assertion in
 * `__tests__/migrationContract.test.ts`. Every entry is merged in memory from
 * tables PR4-7 already write.
 *
 * Each projection is deliberately narrow. None of these queries selects a
 * free-text column, a VF Storage locator, a filename, a JSONB blob, or anything
 * that identifies who was messaged — a timeline row is a fact that something
 * happened, not a copy of its contents. The drawer's existing sections already
 * render the bodies to a manager who is allowed to read them, so restating them
 * here would widen the disclosure surface for no gain. `timelineService.test.ts`
 * greps the SQL these functions issue and fails if a forbidden column reappears.
 *
 * Every statement carries a `fleet-incident-timeline:<source>` comment tag. The
 * service fires all five concurrently, so the tag — not call order — is what
 * identifies a statement in logs and in the tests.
 *
 * WHERE clauses are explicit and parameterized, never conditional tagged-template
 * fragments (CLAUDE.md). The cursor bound is passed as a nullable parameter with
 * a `COALESCE(..., '-infinity')` floor for the same reason: one statement text
 * per source, whether or not the caller is resuming after a cursor.
 */
import { query } from '@/lib/db-pool';

/**
 * The ordering and paging key, rendered as text at the database's own
 * precision.
 *
 * These columns are `timestamptz`, which keeps microseconds. node-pg returns
 * them as a JavaScript `Date`, which keeps milliseconds — so reading the key off
 * the returned value silently drops three digits, and a cursor built from it
 * says `.123` where the row says `.123456`. Postgres then reads
 * `occurred_at > '...123'` as true *for the cursor row itself*: the last row of
 * every page comes back as the first row of the next. Two rows inside one
 * millisecond make it worse than a repeat — ordered one way by the truncated
 * key and the other by microsecond, the walk stops advancing altogether and a
 * row is never reached.
 *
 * So the key is selected as text, at full width, and never rebuilt from a
 * `Date`. Fixed-width UTC text also compares lexicographically in exactly the
 * order it compares chronologically, which is what lets the merge sort on it
 * without parsing it back into a value that cannot hold it.
 */
const SORT_KEY = (column: string): string =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sort_at`;
import type { IncidentActionType, IncidentVisibility } from '../types';
import type { RetentionHoldActionType } from './aggregateSchema';

/**
 * What makes the merge bounded, and what makes it able to reach the end.
 *
 * Every source is read as a keyset: strictly past the cursor's position in the
 * very order the service merges on, `(occurred_at, id)`. An instant-only bound
 * cannot do this. It has to be inclusive, because entries sharing the cursor's
 * instant still have to be reachable — and being inclusive it re-reads the
 * cursor row on every page after the first, spending one of the `limit + 1`
 * slots on a row the merge then discards. `remaining` can then never exceed
 * `limit`, so `nextCursor` is never emitted and the chronology stops dead after
 * two pages. An instant-only ORDER BY is the same failure one level down: with
 * more rows on one instant than a page holds, the database may return a
 * different arbitrary subset per page, and rows in no subset are never shown.
 *
 * `limit + 1` rows per source is enough to be correct, not merely cheap: the
 * merged page is the `limit` smallest entries after the cursor, and a source can
 * contribute at most `limit + 1` of the rows that decide it. A row a source did
 * not return is one that could not have appeared on this page.
 *
 * Because the keyset is exact, nothing the sources return is filtered out again
 * in memory. The predicate below is the only place the cursor is applied.
 */
export interface TimelineBound {
  /** The cursor's instant. `null` reads from the beginning of the history. */
  after: string | null;
  /**
   * The cursor row's id, set only for the source the cursor row came from —
   * ids are meaningless across tables. `null` on the others, which is what the
   * `IS NULL` arm of the predicate reads as "no id to be past".
   */
  afterId: string | null;
  /**
   * Whether this source's rows sharing the cursor's instant sort after the
   * cursor. The service decides it from the fixed source order, since an id
   * comparison cannot settle a tie between two different tables.
   */
  includeAtInstant: boolean;
  /** Maximum rows this source may return — `limit + 1`. */
  limit: number;
}

export interface ActionSourceRow extends Record<string, unknown> {
  id: string;
  action_type: IncidentActionType;
  /** Full-precision UTC sort key — see `SORT_KEY` above. */
  sort_at: string;
  actor_user_id: string | null;
  is_system_actor: boolean;
  occurred_at: string | Date;
  visibility: IncidentVisibility;
}

export interface ObservationSourceRow extends Record<string, unknown> {
  id: string;
  observed_at: string | Date;
  /** Full-precision UTC sort key — see `SORT_KEY` above. */
  sort_at: string;
  recorded_at: string | Date;
}

export interface AttendanceSourceRow extends Record<string, unknown> {
  id: string;
  linked_at: string | Date;
  /** Full-precision UTC sort key — see `SORT_KEY` above. */
  sort_at: string;
}

export interface NotificationSourceRow extends Record<string, unknown> {
  occurred_at: string | Date;
  recipient_count: number;
  /** Full-precision UTC sort key — see `SORT_KEY` above. */
  sort_at: string;
}

export interface RetentionHoldSourceRow extends Record<string, unknown> {
  id: string;
  action_type: RetentionHoldActionType;
  /** Full-precision UTC sort key — see `SORT_KEY` above. */
  sort_at: string;
  actor_user_id: string | null;
  occurred_at: string | Date;
}

/**
 * `fleet_operational_incident_actions` is the spine of the chronology, not one
 * source among several: evidence uploads write an `evidence_added` row
 * (`evidenceService.ts`) and driver replies write a `driver_response_received`
 * row (`driver/submissionService.ts`), so reading the evidence and submission
 * tables as well would report each of those events twice.
 *
 * `actor_staff_id` is deliberately not selected. It is set only on driver rows
 * (migration 511), and the incident header already names the driver, so reading
 * it would add a second copy of an identity the viewer already has.
 */
export async function listActionSource(
  incidentId: string, bound: TimelineBound,
): Promise<ActionSourceRow[]> {
  return query<ActionSourceRow>(
    `/* fleet-incident-timeline:actions */
     SELECT id, action_type, actor_user_id, is_system_actor, occurred_at, visibility,
            ${SORT_KEY('occurred_at')}
       FROM fleet_operational_incident_actions
      WHERE incident_id = $1::uuid
        AND (occurred_at > COALESCE($2::timestamptz, '-infinity'::timestamptz)
             OR (occurred_at = $2::timestamptz AND $4::boolean
                 AND ($3::uuid IS NULL OR id > $3::uuid)))
      ORDER BY occurred_at, id
      LIMIT $5`,
    [incidentId, bound.after, bound.afterId, bound.includeAtInstant, bound.limit],
  );
}

/**
 * The only source that records when something happened separately from when the
 * system found out, so it is the only one whose entries can legitimately show
 * two different timestamps.
 */
export async function listObservationSource(
  incidentId: string, bound: TimelineBound,
): Promise<ObservationSourceRow[]> {
  return query<ObservationSourceRow>(
    `/* fleet-incident-timeline:observations */
     SELECT id, observed_at, recorded_at, ${SORT_KEY('observed_at')}
       FROM fleet_operational_incident_observations
      WHERE incident_id = $1::uuid
        AND (observed_at > COALESCE($2::timestamptz, '-infinity'::timestamptz)
             OR (observed_at = $2::timestamptz AND $4::boolean
                 AND ($3::uuid IS NULL OR id > $3::uuid)))
      ORDER BY observed_at, id
      LIMIT $5`,
    [incidentId, bound.after, bound.afterId, bound.includeAtInstant, bound.limit],
  );
}

/**
 * The link, not the correction's current state: `attendance_adjustments.status`
 * changes after the fact, and a chronology that re-reads it would silently
 * rewrite a past entry every time Attendance moved on. The drawer's existing
 * correction-links section renders the live state instead.
 */
export async function listAttendanceSource(
  incidentId: string, bound: TimelineBound,
): Promise<AttendanceSourceRow[]> {
  return query<AttendanceSourceRow>(
    `/* fleet-incident-timeline:attendance */
     SELECT id, linked_at, ${SORT_KEY('linked_at')}
       FROM fleet_incident_attendance_correction_links
      WHERE incident_id = $1::uuid
        AND (linked_at > COALESCE($2::timestamptz, '-infinity'::timestamptz)
             OR (linked_at = $2::timestamptz AND $4::boolean
                 AND ($3::uuid IS NULL OR id > $3::uuid)))
      ORDER BY linked_at, id
      LIMIT $5`,
    [incidentId, bound.after, bound.afterId, bound.includeAtInstant, bound.limit],
  );
}

/**
 * A count per minute, never a row per person. `notificationBus.notify()` writes
 * one row per in-app recipient inside a loop, so the rows of a single fan-out
 * differ by microseconds; grouping on the raw timestamp would turn one
 * notification into N timeline entries and make the size of the audience
 * readable from the shape of the chronology. Minute truncation collapses a
 * fan-out into far fewer entries than it has recipients — usually the one event
 * it was, though a fan-out that straddles a minute boundary is reported as the
 * two buckets it landed in rather than as one entry.
 *
 * This source keys on the bucket rather than on a row id, because the bucket is
 * its identity as well as its instant: a bucket is atomic, so the cursor's own
 * bucket is behind the cursor in full and the keyset is a plain `>`.
 *
 * The cursor is applied by the HAVING clause, because a bucket cannot be judged
 * before it has been grouped — the HAVING is what excludes the cursor's own
 * bucket. The WHERE floor is not doing that work and does not need to: it is an
 * index-friendly lower bound that lets the scan skip rows no surviving bucket
 * can contain, floored to the minute so a bucket is never counted from part of
 * its rows.
 *
 * One consequence worth knowing: a bucket is ordered by the minute it starts,
 * not by when its rows were written. A notification whose rows were created
 * after another source's event can therefore sit before that event in the
 * chronology, by up to the width of a minute. The alternative — ordering
 * notifications on the raw `created_at` — is what would let the size of the
 * audience be counted off the shape of the chronology, so the minute stays.
 */
export async function listNotificationSource(
  incidentId: string, bound: TimelineBound,
): Promise<NotificationSourceRow[]> {
  return query<NotificationSourceRow>(
    `/* fleet-incident-timeline:notifications */
     SELECT date_trunc('minute', created_at) AS occurred_at, COUNT(*)::int AS recipient_count,
            ${SORT_KEY("date_trunc('minute', created_at)")}
       FROM user_notifications
      WHERE source_module = 'fleet-incidents' AND source_id = $1
        AND created_at >= COALESCE(date_trunc('minute', $2::timestamptz), '-infinity'::timestamptz)
      GROUP BY date_trunc('minute', created_at)
     HAVING date_trunc('minute', created_at) > COALESCE($2::timestamptz, '-infinity'::timestamptz)
             OR (date_trunc('minute', created_at) = $2::timestamptz AND $4::boolean
                 AND ($3::timestamptz IS NULL OR date_trunc('minute', created_at) > $3::timestamptz))
      ORDER BY date_trunc('minute', created_at)
      LIMIT $5`,
    [incidentId, bound.after, bound.afterId, bound.includeAtInstant, bound.limit],
  );
}

/** Hold actions reach the incident through their hold — there is no direct FK. */
export async function listRetentionHoldSource(
  incidentId: string, bound: TimelineBound,
): Promise<RetentionHoldSourceRow[]> {
  return query<RetentionHoldSourceRow>(
    `/* fleet-incident-timeline:retention_holds */
     SELECT a.id, a.action_type, a.actor_user_id, a.occurred_at, ${SORT_KEY('a.occurred_at')}
       FROM fleet_incident_retention_hold_actions a
       JOIN fleet_incident_retention_holds h ON h.id = a.hold_id
      WHERE h.incident_id = $1::uuid
        AND (a.occurred_at > COALESCE($2::timestamptz, '-infinity'::timestamptz)
             OR (a.occurred_at = $2::timestamptz AND $4::boolean
                 AND ($3::uuid IS NULL OR a.id > $3::uuid)))
      ORDER BY a.occurred_at, a.id
      LIMIT $5`,
    [incidentId, bound.after, bound.afterId, bound.includeAtInstant, bound.limit],
  );
}
