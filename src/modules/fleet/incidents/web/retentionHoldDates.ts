/**
 * The one place a retention-hold date crosses between a calendar day and an
 * instant (stage 8, task 9b).
 *
 * `<input type="date">` yields a bare `YYYY-MM-DD`. The server parses
 * `nextReviewAt` with `parseStrictIsoInstant`, which refuses anything that is
 * not a full ISO-8601 instant — so sending the raw control value makes every
 * create and every review a 400, and no amount of clicking fixes it.
 *
 * The day is anchored to SAST rather than to the browser's zone: the operators
 * are in Africa/Johannesburg, the purge and reminder jobs run on SAST
 * schedules, and a laptop set to UTC would otherwise place "1 December" two
 * hours later than the same day chosen on the machine beside it.
 */

/** Africa/Johannesburg has no DST, so a fixed offset is exact all year. */
const SAST_OFFSET = '+02:00';
/**
 * The shape this function accepts, stated rather than inferred. V8 happens to
 * reject every malformed day tried in `retentionHoldDates.test.ts` once the
 * offset is appended, so today this check is belt to the parser's braces — a
 * mutation that removes it survives, and that is recorded rather than hidden.
 * It stays because the contract is "a calendar day": without it the function
 * is only as strict as whatever the engine's date parser tolerates next.
 */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Converts a `YYYY-MM-DD` calendar day to the ISO instant at which that day
 * begins in SAST. Returns null for anything that is not a calendar day, so a
 * caller refuses to send rather than sending something the server will reject.
 */
export function sastDayStartInstant(day: string): string | null {
  if (!CALENDAR_DAY.test(day)) return null;
  const parsed = Date.parse(`${day}T00:00:00${SAST_OFFSET}`);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** Renders a stored instant as the SAST calendar day an operator would name it by. */
export function formatSastDate(value: string): string {
  return new Date(value).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' });
}
