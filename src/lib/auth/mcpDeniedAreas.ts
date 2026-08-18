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
 * So the decision moves here, beside `isReadOnlyViolation`, applied in the same places:
 * one implementation, every caller, every current and future route, and no client able
 * to forget it. The Python and catalogue guards stay — they save a round-trip and stop
 * the model proposing a path it will only be refused — but they are now conveniences
 * over a real boundary rather than the boundary itself.
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

  let current = rawPath;
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

  const path = current.toLowerCase().split('?')[0]!.split('#')[0]!;
  if (!path.startsWith('/api/')) return null;
  // A shape check rather than a list of bad bytes. `/api/staff /list` and
  // `/api/staff./list` reduce to a GROUP of "staff " and "staff." — neither equal to
  // "staff" nor prefixed by "staff-", so a literal comparison waves them through. That
  // is exactly the trailing-byte bypass found in the Python guard. Stating what a path
  // may contain and refusing the rest closes the whole class instead of the instances.
  if (!/^\/api(\/[a-z0-9.][a-z0-9._-]*)*\/?$/.test(path)) return null;
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

/** The group or path that a request matched, or undefined when it matched nothing. */
export function deniedAreaFor(rawPath: string | undefined): string | undefined {
  const path = canonical(rawPath);
  if (path === null) return undefined;

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
  if (canonical(rawPath) === null) return true;
  return deniedAreaFor(rawPath) !== undefined;
}
