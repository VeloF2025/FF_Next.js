/**
 * Which /api/* routes are legitimately reachable without a user session, and whether a
 * request carries any credential at all.
 *
 * Background: `middleware.ts` does not enforce session auth — it only rate-limits. Every
 * API route is therefore opt-in, and an audit on 2026-07-27 found 50 mutating App Router
 * routes reachable with no credential (see the NOC incident: 5 of them served full ticket
 * CRUD to anonymous callers in production).
 *
 * This module exists to make that class of bug measurable BEFORE it is enforced. Flipping
 * a deny-by-default gate on an allowlist assembled by reading code is how a working
 * integration gets taken down by a route nobody remembered. So the middleware consumes
 * this in log-only mode first: it records what it WOULD refuse and refuses nothing.
 *
 * Edge-runtime safe: pure string work, no node APIs, no I/O.
 */

/**
 * Every cookie that represents a logged-in caller. There are THREE separate session
 * systems in this app, and each one missed here becomes a flood of false positives:
 *
 *   ff_auth_token      main app            src/lib/auth (withAuth / requireAuth)
 *   ff_my_session      staff portal        withMySession — ~49 routes under /api/my
 *                                          (attendance, payslips, receipts, stores);
 *                                          MY_SESSION_COOKIE in
 *                                          src/modules/attendance/portal/sessionUtils.ts
 *   ff_portal_session  FLEET portal        PORTAL_SESSION_COOKIE in
 *                                          src/modules/fleet/portal/createPortalSession.ts
 *
 * The middle and last are easy to confuse — sessionUtils.ts even carries a comment
 * distinguishing them. Getting that wrong does not fail loudly: it produces a plausible
 * dataset saying the staff portal is hammered by anonymous traffic, which would argue for
 * allowlisting /api/my outright. Exactly backwards.
 */
const SESSION_COOKIES = ['ff_auth_token', 'ff_my_session', 'ff_portal_session'] as const;

/**
 * Prefixes that must stay reachable anonymously, with the reason each one is here.
 * A prefix matches the exact path or anything below it.
 *
 * Keep the reason attached. An allowlist without reasons rots into "don't touch this",
 * and the entries nobody can justify are exactly the ones that should be removed.
 */
export const PUBLIC_API_PREFIXES: ReadonlyArray<{ prefix: string; why: string }> = [
  { prefix: '/api/health', why: 'liveness probe — deploy scripts and uptime checks' },
  { prefix: '/api/monitoring', why: 'liveness/metrics probes' },
  { prefix: '/api/auth', why: 'login, check-email, forgot/reset password — pre-session by definition' },
  { prefix: '/api/my/login', why: 'staff portal PIN/OTP login — pre-session by definition' },
  { prefix: '/api/cron', why: 'scheduled jobs; authenticate with their own secret header, not a session' },
  { prefix: '/api/noc/webhooks', why: 'inbound provider callbacks (QContact) — no session to present' },
  { prefix: '/api/communications/whatsapp/cloud-webhook', why: 'Meta WhatsApp Cloud webhook — signature-verified, not session-verified' },
  { prefix: '/api/cortex-remote-mcp', why: 'MCP transport; the upstream OAuth server must issue its own 401 challenge' },
  { prefix: '/api/snags/shared', why: 'public subcontractor snag links; the URL share token IS the credential (pages/api/snags/shared/[token].ts)' },
];

/** True when the path is one the app intends to serve without a user session. */
export function isPublicApiRoute(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Query params that carry a credential.
 *
 * A third transport, not a variation on the header list. `/api/construction-qa/photo-proxy`
 * authorises the VLM via `?vlm=true&vlmkey=<VLM_PROXY_SECRET>` precisely BECAUSE vLLM
 * fetches image URLs with a plain GET and cannot send headers — see
 * src/lib/vlm/photoProxyAuth.ts and the #2211 bypass incident. Several construction-qa
 * and cron routes also accept `?secret=` as an alternate transport for CRON_SECRET.
 *
 * A cookies+headers-only check is structurally blind to all of it.
 */
const CREDENTIAL_QUERY_PARAMS = ['vlmkey', 'secret'] as const;

/** Param names whose VALUES must never reach a log line. */
export const SECRET_QUERY_PARAMS: ReadonlySet<string> = new Set(CREDENTIAL_QUERY_PARAMS);

/**
 * Whether the request presents ANY credential — session cookie, bearer token, service
 * secret header, or credential-bearing query param.
 *
 * Deliberately does NOT validate it. Middleware runs on the Edge runtime and cannot
 * reach the database, so validity is the route handler's job. The question here is only
 * "did this caller present anything at all", which is what distinguishes a logged-in
 * user from an anonymous request. Treating a forged token as "credentialed" is fine:
 * the handler still rejects it, and for audit purposes a forged token is not the
 * anonymous-access signal we are hunting.
 */
export function hasAnyCredential(req: {
  cookies: { get(name: string): { value: string } | undefined };
  headers: { get(name: string): string | null };
  /** Optional so non-URL callers still type-check; omitted means "no query credential". */
  searchParams?: { get(name: string): string | null };
}): boolean {
  for (const cookie of SESSION_COOKIES) {
    if (req.cookies.get(cookie)?.value) return true;
  }

  const authorization = req.headers.get('authorization');
  if (authorization && authorization.trim() !== '') return true;

  // Only headers this codebase actually reads — every one verified by grep. Speculative
  // entries would be dead OR branches that quietly widen what counts as "credentialed".
  //
  //   x-api-key           general service callers
  //   x-cron-secret       scheduled jobs
  //   x-bridge-secret     Go WhatsApp Bridge → FF, 7 routes (inbound messages, DR acks,
  //                       field-ops). A separate VPS posting continuously, 24/7 — the
  //                       highest-volume machine caller in the system.
  //   x-wa-bridge-secret  same bridge, peer-service reads (noc/wa-monitored-groups)
  //   x-webhook-secret    dev/build harness progress callback
  //   x-internal-key      OLT report queue processor
  //
  // ⚠️ x-internal-key is compared against a literal committed to source
  // (pages/api/system/olt-report/process-lookup-queue.ts:234). Recognising it here is
  // correct — it IS how that caller authenticates today — but the literal itself is a
  // committed credential and wants rotating into an env var. Out of scope for this PR.
  for (const header of [
    'x-api-key',
    'x-cron-secret',
    'x-bridge-secret',
    'x-wa-bridge-secret',
    'x-webhook-secret',
    'x-internal-key',
  ]) {
    const value = req.headers.get(header);
    if (value && value.trim() !== '') return true;
  }

  for (const param of CREDENTIAL_QUERY_PARAMS) {
    const value = req.searchParams?.get(param);
    if (value && value.trim() !== '') return true;
  }

  return false;
}

/**
 * Would a deny-by-default API gate refuse this request?
 *
 * `true` means: an anonymous caller reached a route that is not on the public allowlist.
 * In log-only mode this is recorded and the request proceeds untouched.
 */
export function wouldDenyApiRequest(
  pathname: string,
  req: Parameters<typeof hasAnyCredential>[0],
): boolean {
  if (!pathname.startsWith('/api/')) return false;
  if (isPublicApiRoute(pathname)) return false;
  return !hasAnyCredential(req);
}
