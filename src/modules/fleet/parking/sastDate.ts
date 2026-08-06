/**
 * The SAST calendar date for an instant.
 *
 * Its own module because both the orchestrator and the cron endpoint need it,
 * and the endpoint should not have to reach through the orchestrator — which
 * carries the whole database import chain — for a pure date helper. Tests that
 * mock the orchestrator out then don't have to re-implement it either.
 *
 * The server runs in Africa/Johannesburg today, but deriving the date
 * explicitly means a future host in another zone cannot silently shift every
 * check_date. `en-CA` is used because it formats as YYYY-MM-DD.
 */
export function sastDateString(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
