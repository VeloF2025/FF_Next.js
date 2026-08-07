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
      'still logged out',
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
