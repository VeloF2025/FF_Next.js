/**
 * Classifies a provider failure as a credentials problem or a transient blip.
 *
 * Extracted from pollProvider.ts so the classifier — which governs alerting for
 * every provider — lives beside its own test file rather than inside the poll
 * loop.
 */
/**
 * Whether a failure is a credentials/entitlement problem rather than a blip.
 *
 * This decides the alert channel, and the two branches are not close: `auth`
 * raises immediately over WhatsApp because it will never self-heal, while
 * `transient` stays silent until TRANSIENT_THRESHOLD consecutive failures.
 *
 * It classifies by MESSAGE TEXT, so every provider's auth vocabulary has to be
 * listed here explicitly. A provider whose wording is missing is not merely
 * unclassified — it is silently downgraded to `transient`, and at a 2-hourly
 * cadence that is hours of silence plus no WhatsApp for a dead password. When
 * adding a provider, add its phrasing here and cover it in the tests below.
 */
export function isAuthFailure(message: string): boolean {
  return new RegExp(
    [
      // Netstar / generic.
      'login failed',
      String.raw`HTTP 401\b`,
      String.raw`HTTP 403\b`,
      // Ituran: the token was refused and a fresh mint did not help.
      'still rejected after re-mint',
      // Ituran: the portal took the credentials and did not hand back a session.
      'login did not yield a session',
      // Ituran: the WAF never let us reach the login form at all. Not strictly
      // a credentials fault, but it equally will not fix itself on the next
      // tick and equally needs a human.
      'bot challenge did not clear',
      // Cartrack portal. Its rejected-credential message already contains
      // "login failed" above; these two do not, and the first is especially
      // urgent because that endpoint counts failures toward a lockout.
      'still unauthenticated after re-login',
      'issued no session cookies',
    ].join('|'),
    'i'
  ).test(message);
}

/**
 * Whether a failure is Netstar's single-session limit rather than bad credentials.
 *
 * PortalSession throws "still logged out after re-auth" when it logged in
 * successfully and was then evicted — which is what happens when a human opens
 * the same portal. That self-heals when they leave, so it must not page.
 *
 * It was previously matched by isAuthFailure's 'still logged out' entry and
 * therefore raised fleet.tracking_pull_failed, the WhatsApp-enabled event. At a
 * 2-hourly cadence that collided with a human 12 times a day at most. The
 * cadence ramp takes that to 144, so an operator working in the portal for an
 * hour would have paged roughly six times for a healthy system.
 *
 * A dead password can produce the same message, so callers must escalate this
 * when it persists — see EVICTION_ESCALATE_AFTER_MS in alerts.ts.
 */
export function isEviction(message: string): boolean {
  return /still logged out/i.test(message);
}

/**
 * The three streaks `consecutive_failures` can carry: a genuine credentials
 * problem, Netstar's single-session eviction, or everything else. Kept private
 * — callers only need isSameFailureKind's boolean, not the label.
 */
type FailureKind = 'auth' | 'evicted' | 'transient';

function failureKind(message: string): FailureKind {
  if (isAuthFailure(message)) return 'auth';
  if (isEviction(message)) return 'evicted';
  return 'transient';
}

/**
 * Whether two failures belong to the same streak.
 *
 * `fleet_tracking_watermarks.consecutive_failures` is incremented by the gap
 * branch as well as the error branch, so it counts consecutive failures of ONE
 * KIND rather than failures in general. Without that distinction a long gap
 * streak carries its count into the auth breaker, and a single auth failure
 * landing on a count already past the hard-stop ceiling would skip the open and
 * half-open states entirely and demand manual SQL to clear.
 *
 * THREE-WAY, not `isAuthFailure(a) === isAuthFailure(b)`: once eviction left
 * isAuthFailure, that two-way formula called an eviction and an ordinary
 * transient failure the same kind (both `false`) and merged their streaks —
 * corrupting both the transient alert threshold and evicted_since, the clock
 * eviction's own escalation depends on. See failureKind above.
 */
export function isSameFailureKind(a: string | null, b: string | null): boolean {
  return failureKind(a ?? '') === failureKind(b ?? '');
}
