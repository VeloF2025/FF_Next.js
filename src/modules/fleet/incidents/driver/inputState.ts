/**
 * Pure driver-input state and response-window calculation. Nothing here
 * touches the database — `DriverInputState` is never a stored column
 * (design §5: "independent of incident lifecycle"); it is always derived
 * fresh from the current request/submission/terminal timestamps a caller
 * (repository or service) already has in hand. Keeping this pure makes the
 * five-state machine and the SAST due-date math exhaustively unit-testable
 * without a database.
 */
import type { DriverInputState } from './types';

const SAST_TIME_ZONE = 'Africa/Johannesburg';
const SAST_FIXED_OFFSET = '+02:00';
const DAY_MS = 24 * 60 * 60 * 1000;
/** JS `Date#getUTCDay()`/weekday convention: 0=Sunday .. 6=Saturday. */
const DEFAULT_SCHEDULED_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

interface SastDateParts { year: number; month: number; day: number; weekday: number }

/** Reads the SAST (`Africa/Johannesburg`, fixed UTC+2, no DST) wall-clock calendar day and weekday for a real instant — never a naive UTC-string truncation, which would misclassify anything in the 22:00-23:59 UTC band as the previous SAST day. */
function sastDateParts(instant: Date): SastDateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAST_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(get('year')), month: Number(get('month')), day: Number(get('day')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

function pad2(value: number): string { return String(value).padStart(2, '0'); }

/** The real UTC instant for 23:59:59.999 SAST on the given SAST calendar day. */
function sastEndOfDay(parts: SastDateParts): Date {
  return new Date(`${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T23:59:59.999${SAST_FIXED_OFFSET}`);
}

export interface CalculateRespondByArgs {
  /** ISO instant the request was created (server-derived `now`, not user input). */
  requestedAt: string;
  /** Number of the driver's scheduled working days after `requestedAt` the window covers. */
  responseWindowWorkdays: number;
  /** Weekday numbers (0=Sun..6=Sat) the driver's Attendance schedule has them working. `null`/empty falls back to Monday-Friday (design §6). */
  scheduledWeekdays: readonly number[] | null;
}

/**
 * End of the driver's Nth scheduled working day after `requestedAt`, in SAST,
 * expressed as the equivalent UTC instant. Counting starts the day *after*
 * `requestedAt`'s SAST calendar day, even when that day is itself scheduled.
 */
export function calculateRespondBy(args: CalculateRespondByArgs): Date {
  if (!Number.isInteger(args.responseWindowWorkdays) || args.responseWindowWorkdays <= 0) {
    throw new RangeError('responseWindowWorkdays must be a positive integer');
  }
  const requestedMs = new Date(args.requestedAt).getTime();
  if (Number.isNaN(requestedMs)) throw new RangeError('requestedAt must be a valid instant');

  const scheduledWeekdays = args.scheduledWeekdays && args.scheduledWeekdays.length > 0
    ? args.scheduledWeekdays
    : DEFAULT_SCHEDULED_WEEKDAYS;

  let remaining = args.responseWindowWorkdays;
  let cursorMs = requestedMs;
  let matched = sastDateParts(new Date(requestedMs));
  while (remaining > 0) {
    cursorMs += DAY_MS;
    const candidate = sastDateParts(new Date(cursorMs));
    if (scheduledWeekdays.includes(candidate.weekday)) {
      remaining -= 1;
      matched = candidate;
    }
  }
  return sastEndOfDay(matched);
}

export interface DeriveDriverInputStateArgs {
  /** Server-derived current instant (ISO). */
  now: string;
  /** The latest non-superseded request for the incident, or null if none was ever made. */
  currentRequest: { requestedAt: string; respondBy: string } | null;
  /** The latest driver submission at/after `currentRequest.requestedAt`, or null. Meaningless when `currentRequest` is null. */
  respondedAt: string | null;
  /** `resolved_at` — set for both terminal lifecycle statuses (`resolved` and `dismissed`); null while the incident is active. */
  incidentTerminalAt: string | null;
  postClosureResponseEnabled: boolean;
  postClosureResponseWindowDays: number;
}

/**
 * Derives the presentation state from design §5's machine:
 * `not_requested -> requested -> responded | expired`, with `closed` as the
 * terminal presentation once manager review ends and the (possibly
 * post-closure-extended) response policy no longer permits a submission.
 * A response already received is sticky — it is never reclassified as
 * `closed` just because the incident later becomes terminal.
 */
export function deriveDriverInputState(args: DeriveDriverInputStateArgs): DriverInputState {
  if (!args.currentRequest) return 'not_requested';
  if (args.respondedAt !== null) return 'responded';

  const nowMs = new Date(args.now).getTime();
  if (args.incidentTerminalAt !== null) {
    if (args.postClosureResponseEnabled) {
      const deadlineMs = new Date(args.incidentTerminalAt).getTime() + args.postClosureResponseWindowDays * DAY_MS;
      if (nowMs <= deadlineMs) return 'requested';
    }
    return 'closed';
  }
  return nowMs <= new Date(args.currentRequest.respondBy).getTime() ? 'requested' : 'expired';
}
