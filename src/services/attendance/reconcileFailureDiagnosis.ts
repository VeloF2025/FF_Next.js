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

/**
 * Joins as many whole lines as fit, then appends a count of what was dropped.
 * The suffix is reserved up front so the result always fits the budget, and the
 * first line is always emitted even if it alone exceeds it — a truncated first
 * line is still more diagnostic than an empty message.
 */
function joinWithinBudget(lines: string[]): string {
  const whole = lines.join('\n');
  if (whole.length <= MAX_MESSAGE_CHARS) return whole;

  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const suffix = `\n… ${lines.length - kept.length - 1} more day(s) omitted`;
    const cost = (kept.length === 0 ? 0 : 1) + line.length;
    if (used + cost + suffix.length > MAX_MESSAGE_CHARS) break;
    kept.push(line);
    used += cost;
  }

  if (kept.length === 0) return lines[0]!.slice(0, MAX_MESSAGE_CHARS);
  return `${kept.join('\n')}\n… ${lines.length - kept.length} more day(s) omitted`;
}
