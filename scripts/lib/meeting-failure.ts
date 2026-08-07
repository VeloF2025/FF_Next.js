/**
 * Shared failure persistence for the meeting maintenance scripts.
 *
 * `processWithLLM` throws rather than writing a status of its own, because both
 * graph callers force `processing_status = 'completed'` on the line after it
 * returns and would clobber an in-place write. Its contract is therefore that
 * *every* caller persists the failure itself (see the TranscriptMissingError
 * docstring in src/lib/llm/meeting-processor.ts).
 *
 * The CLI scripts used to only `console.error` the message, so a meeting whose
 * processing threw kept whatever status it had before — usually 'processing',
 * occasionally a stale 'completed' — with no processing_error to explain it.
 * PR #2393 made those throws routine rather than rare, which is what turned a
 * latent gap into a reporting problem.
 */

/** Minimal tagged-template shape shared by pg.Pool wrappers and neon(). */
export type SqlFn = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

/** Postgres `text` has no length cap, but an unbounded LLM/HTTP body in an
 *  error column helps nobody and bloats every row read. */
const MAX_ERROR_CHARS = 2000;

export function toErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.trim() || 'Unknown error';
  return msg.length > MAX_ERROR_CHARS ? `${msg.slice(0, MAX_ERROR_CHARS)}…` : msg;
}

/**
 * Persist `processing_status = 'failed'` plus the error text for one meeting.
 *
 * Mirrors the UPDATE in src/lib/graph/meeting-processor.ts so a meeting that
 * fails in a script is indistinguishable from one that fails in the pipeline.
 */
export async function markMeetingFailed(
  sql: SqlFn,
  meetingId: number,
  err: unknown,
): Promise<void> {
  const message = toErrorMessage(err);
  await sql`
    UPDATE meetings
    SET processing_status = 'failed',
        processing_error  = ${message},
        updated_at        = NOW()
    WHERE id = ${meetingId}
  `;
}

export type MeetingStepResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Run one meeting's work, persisting `failed` if it throws.
 *
 * Returns a result rather than rethrowing: these scripts process a batch and
 * one bad meeting must not abort the remaining ones.
 *
 * A failure while *recording* the failure is deliberately swallowed onto
 * `onPersistError` — the original error is the one the operator needs, and
 * letting the bookkeeping write mask it would be strictly worse than the bug
 * this function exists to fix.
 */
export async function runMeetingStep<T>(
  sql: SqlFn,
  meetingId: number,
  fn: () => Promise<T>,
  onPersistError?: (err: unknown) => void,
): Promise<MeetingStepResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err: unknown) {
    const error = toErrorMessage(err);
    try {
      await markMeetingFailed(sql, meetingId, err);
    } catch (persistErr: unknown) {
      onPersistError?.(persistErr);
    }
    return { ok: false, error };
  }
}
