/**
 * Areas an MCP session may never read — enforced server-side.
 *
 * This list already existed twice: in `scripts/build-mcp-endpoint-catalogue.ts`, which
 * withholds the routes from the catalogue, and in `apps/ff_mcp/tools.py`, which refuses
 * them at call time. Both say plainly what that was worth:
 *
 *   "a blast-radius guard, NOT a security boundary: anyone holding the token can still
 *    curl these paths directly, and RBAC + the read-only gate remain the real controls"
 *
 * That was a fair trade while the only holder was Claude's own connector. It stops being
 * fair once FibreFlow issues a credential to Cortex, for two reasons:
 *
 *   1. A second consumer means a third copy of the list. Copies drift — a change landed
 *      in the runtime guard and not the catalogue generator in the same week this module
 *      was written, and every test passed while the two disagreed about what existed.
 *   2. "Anyone holding the token can still curl these paths" describes a leaked
 *      credential exactly. The client-side guard protects against an agent wandering; it
 *      protects against nothing else.
 *
 * So the decision moves here, beside `isReadOnlyViolation`, applied at the same call
 * sites. The Python and catalogue guards stay — they save a round-trip and stop the model
 * proposing a path it will only be refused — but they are now conveniences over a real
 * boundary rather than the boundary itself.
 *
 * WHAT THIS DOES NOT COVER, stated precisely because a security comment that overclaims
 * is worse than none:
 *
 * The gate runs wherever a request resolves an AuthUser — `withAuth`, `withOptionalAuth`,
 * `withFleetAuth` in the Pages Router, `requireAuth`/`requirePermission` in the App
 * Router. It therefore cannot run on a route that resolves no user at all, and 85 of the
 * 127 `app/api/**` routes call none of those wrappers. Those routes have no session auth
 * of ANY kind — see the note at middleware.ts, and the 2026-07-27 audit that found 50
 * mutating App Router routes reachable with no credential (#2255). Several of their
 * groups (`conduit`, `tracker`, `noc`, `dev-queue`) are catalogued and so are advertised
 * to MCP clients.
 *
 * This gate does not change that exposure in either direction: those routes were
 * reachable by anyone before and remain so. It is a real boundary for every route that
 * authenticates, and silent on every route that does not. Closing the rest is the
 * separately-tracked opt-in-auth problem, not something this module can reach.
 *
 * SCOPE, deliberately narrow: this restricts `kind='mcp'` sessions only. Staff open
 * payroll and their own payslips in the browser every day; an interactive session is
 * untouched.
 */

import type { AuthUser } from './types';

/**
 * Route groups no MCP session may read. Matched on the first path segment, and on any
 * hyphenated sibling of it — routes here are flattened, so one logical area spreads
 * across several group names and `staff` must also cover `staff-documents`.
 */
export const MCP_DENIED_GROUPS: readonly string[] = [
  'accounting',
  'staff',
  'my',
  'action-items',
  'meetings',
  'procurement',
  // The MCP edge proxies are transport, not data: they forward any method and body to an
  // internal service and are unauthenticated by design.
  'cortex-remote-mcp',
  'ff-remote-mcp',
];

/**
 * Individual routes denied where denying the whole group would be too broad.
 *
 * `/api/field/attendance` carries the same permission key as the supervisor-scoped
 * report but applies no scope, so any holder gets the whole field workforce with clock
 * times and geofence ids. `field` cannot be a denied GROUP because the sibling rule would
 * also match `field-stock` — the entire warehouse module.
 */
export const MCP_DENIED_PATHS: readonly string[] = ['/api/field/attendance'];

/** What a segment carrying a routing DECISION may contain. */
const SEGMENT_SHAPE = /^[a-z0-9][a-z0-9._-]*$/;

export const MCP_DENIED_AREA_CODE = 'MCP_AREA_DENIED';
export const MCP_DENIED_AREA_MESSAGE =
  'This area is not available to read-only integration tokens.';

/**
 * Reduce a request path to what the router will actually match.
 *
 * Returns null when the path cannot be reduced to a plain API path — which the caller
 * treats as a refusal, not a pass. Guessing at a malformed path is how a guard gets
 * walked around; every bypass found in the Python equivalent was a string the guard and
 * the router read differently.
 */
function canonical(rawPath: string | undefined): string | null {
  if (!rawPath) return null;

  // The query and fragment are stripped BEFORE decoding, and never looked at again.
  //
  // Decoding first was a real defect: `?search=80%25` decodes to `?search=80%`, and the
  // next iteration then sees a bare `%` and throws, so the whole request was refused —
  // a 403 on a permitted route for any user who typed a percent sign into a search box.
  // Nothing after the `?` can change which route Next matches, so the guard has no
  // business reading it.
  const withoutQuery = rawPath.split('?')[0]!.split('#')[0]!;

  let current = withoutQuery;
  for (let i = 0; i < 5; i += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      // Malformed escape — unparseable, so refuse rather than guess.
      return null;
    }
    if (decoded === current) break;
    current = decoded;
  }

  const path = current.toLowerCase();
  if (!path.startsWith('/api/')) return null;
  // A shape check rather than a list of bad bytes: `/api/staff /list` reduces to a GROUP
  // of "staff ", which is neither "staff" nor prefixed by "staff-", so a literal
  // comparison waves it through. Stating what a path may contain closes that whole class.
  //
  // But ONLY the group segment needs to be strict, and an over-strict rule here is an
  // outage rather than a hole: five catalogued catch-alls (`/api/uploads/:path*`,
  // `/api/activate/photo/:path*` and siblings) carry real storage keys as path segments,
  // and 20,999 of 98,462 live keys contain spaces or parentheses —
  // "WhatsApp Image 2026-03-18 at 3.17.46 PM (1).jpeg". Refusing those 403s a fifth of
  // the photo library on a permitted route.
  //
  // So: the GROUP segment is constrained tightly, and the tail is allowed anything
  // except the separators and control characters that could change which route matches.
  // The group segment is always strict: it is what every group decision is made on.
  const rawSegments = path.split('/');
  if (!SEGMENT_SHAPE.test(rawSegments[2] ?? '')) return null;

  // And any path that is a NEAR-MISS for a denied path is refused rather than allowed.
  //
  // MCP_DENIED_PATHS is matched byte-exactly, so once the tail became permissive
  // `/api/field/attendance;x=1` stopped being recognised as `/api/field/attendance` —
  // the trailing-byte class the old whole-path rule closed, reopened for exactly the
  // list designed to grow. Requiring strictness by DEPTH instead would refuse
  // `/api/uploads/a b/c(1).jpg`, whose permissive content sits at the same depth, so the
  // rule is scoped to candidates: same leading segments, last one merely prefixed.
  for (const denied of MCP_DENIED_PATHS) {
    const deniedSegments = denied.split('/');
    const last = deniedSegments.length - 1;
    if (rawSegments.length <= last) continue;
    const leadingMatches = deniedSegments
      .slice(1, last)
      .every((segment, index) => rawSegments[index + 1] === segment);
    if (!leadingMatches) continue;
    const candidate = rawSegments[last]!;
    if (candidate !== deniedSegments[last] && !SEGMENT_SHAPE.test(candidate)) return null;
  }
  // eslint-disable-next-line no-control-regex -- control bytes are exactly what is refused
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return null;
  // `..` is refused rather than resolved: resolving it would silently accept
  // `/api/reporting/../staff/list`, which reads as an allowed path and routes to a
  // denied one.
  if (path.includes('..')) return null;

  const segments = path.split('/').filter((segment) => segment !== '' && segment !== '.');
  // A dot INSIDE a segment is data (`a.b.jpg`); a segment ENDING in one is the
  // trailing-byte bypass wearing a legal character — `staff.` is not `staff`, so a
  // literal comparison lets it through while some routers resolve it to the same place.
  if (segments.some((segment) => segment.endsWith('.'))) return null;
  return `/${segments.join('/')}`;
}

/** The group or path a CANONICAL path matches, or undefined when it matches nothing. */
function matchDeniedArea(path: string): string | undefined {
  for (const denied of MCP_DENIED_PATHS) {
    if (path === denied || path.startsWith(`${denied}/`)) return denied;
  }

  // Segment 0 is "api"; segment 1 is the group.
  const group = path.split('/')[2] ?? '';
  for (const denied of MCP_DENIED_GROUPS) {
    if (group === denied || group.startsWith(`${denied}-`)) return denied;
  }

  return undefined;
}

/**
 * The group or path a raw request path matched, or undefined when it matched nothing.
 *
 * Returns the sentinel `'unparseable'` rather than undefined for a path canonical()
 * rejects. isDeniedAreaViolation fails CLOSED on those, and a helper that reported them
 * as "nothing matched" would fail open — the obvious next use of this function is naming
 * the refused area in the 403 body, where the two must not be confused.
 */
export function deniedAreaFor(rawPath: string | undefined): string | undefined {
  const path = canonical(rawPath);
  return path === null ? 'unparseable' : matchDeniedArea(path);
}

/**
 * Whether this request must be refused.
 *
 * Fails closed for MCP sessions: a path that cannot be canonicalised is refused, because
 * an unparseable path is not evidence of innocence. Browser sessions are unaffected in
 * both directions — a malformed URL there is the router's problem, not an auth decision.
 */
export function isDeniedAreaViolation(
  user: AuthUser,
  rawPath: string | undefined,
): boolean {
  if (user.sessionKind !== 'mcp') return false;
  // Canonicalised once and threaded through: this runs on every authenticated request,
  // and deniedAreaFor would otherwise repeat the decode loop.
  const path = canonical(rawPath);
  if (path === null) return true;
  return matchDeniedArea(path) !== undefined;
}
