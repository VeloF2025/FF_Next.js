/**
 * Builds the `error_message` persisted on `attendance_reconciliation_runs` for a
 * run that finished with failed days.
 *
 * Before #2480 a partial run reached the database with no diagnosis at all: the
 * row recorded which days failed but not why, and the reason survived only in
 * the cron log file. Two consecutive partial nights went unnoticed as a result.
 */

/**
 * Ceiling on the persisted message. `error_message` is `text`, so Postgres
 * imposes no limit — this is a self-imposed cap to keep one pathological run
 * from writing an unbounded blob, and it matches the per-error cap used by the
 * caller.
 */
const MAX_MESSAGE_CHARS = 2_000;

const PENDING_CLOSED_REASON = 'system-closed but not projected';
const UNKNOWN_REASON = 'unknown failure';

/**
 * One line per failed day, in the same order as `failedDayKeys`. Returns null
 * for a clean run so a succeeded row keeps a NULL error_message.
 *
 * Days in `pendingClosed` were system-closed but never projected; there is no
 * thrown error to quote for them, so they are labelled explicitly rather than
 * silently omitted — a key in `failedDayKeys` with no line here would be worse
 * than the bug being fixed.
 *
 * Truncation drops whole lines and says how many it dropped. Cutting the joined
 * string mid-line would leave a day key attached to half a reason, which is the
 * same "appears in failedDayKeys, no way to know why" problem #2480 exists to
 * remove — just reached by a different route.
 */
export function buildFailureDiagnosis(
  failedDayKeys: string[],
  failed: ReadonlyMap<string, string>,
  pendingClosed: ReadonlySet<string>,
): string | null {
  if (failedDayKeys.length === 0) return null;

  const lines = failedDayKeys.map((key) => {
    const reason = failed.get(key)
      ?? (pendingClosed.has(key) ? PENDING_CLOSED_REASON : UNKNOWN_REASON);
    return `${key}: ${reason}`;
  });

  return joinWithinBudget(lines);
}

function omittedMarker(count: number): string {
  return `\n… ${count} more day(s) omitted`;
}

/**
 * Joins as many whole lines as fit, then appends a count of what was dropped.
 * The marker is reserved up front so the result always fits the budget.
 *
 * A single line can exceed the budget on its own: `reconcile.ts` caps each
 * error at MAX_MESSAGE_CHARS before it reaches the map, so one verbose driver
 * error plus a day key is already over. That line is truncated rather than
 * dropped — a cut reason still names the failing day — but the marker is still
 * emitted, because losing the other days silently is the same "in
 * failedDayKeys with no way to know why" gap this module exists to close.
 */
function joinWithinBudget(lines: string[]): string {
  const whole = lines.join('\n');
  if (whole.length <= MAX_MESSAGE_CHARS) return whole;

  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const marker = omittedMarker(lines.length - kept.length - 1);
    const cost = (kept.length === 0 ? 0 : 1) + line.length;
    if (used + cost + marker.length > MAX_MESSAGE_CHARS) break;
    kept.push(line);
    used += cost;
  }

  if (kept.length > 0) {
    return `${kept.join('\n')}${omittedMarker(lines.length - kept.length)}`;
  }

  // Not even the first line fits. With no other days to report there is nothing
  // to signal, so a plain truncation is honest; otherwise the marker must
  // survive, so reserve its length out of the first line.
  const first = lines[0]!;
  if (lines.length === 1) return first.slice(0, MAX_MESSAGE_CHARS);
  const marker = omittedMarker(lines.length - 1);
  return `${first.slice(0, MAX_MESSAGE_CHARS - marker.length)}${marker}`;
}
