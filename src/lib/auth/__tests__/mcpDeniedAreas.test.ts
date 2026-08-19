/**
 * Server-side enforcement of the MCP denied areas — written BEFORE the implementation.
 *
 * Until now the denylist existed only in the CLIENTS: the endpoint catalogue and the
 * Python guard in apps/ff_mcp/tools.py. Both files say plainly what that means —
 * "a blast-radius guard, NOT a security boundary: anyone holding the token can still
 * curl these paths directly". That was acceptable while the only holder was Claude's
 * connector. It stops being acceptable now that a FibreFlow credential is issued to
 * Cortex, because a second consumer means a second copy of the list, and a copy that
 * drifts is worse than no copy — this session already shipped a bug where the catalogue
 * generator and the runtime guard disagreed after only one was changed.
 *
 * So the check moves to withAuth, beside isReadOnlyViolation: one implementation, every
 * caller, every current and future route, no client able to forget it.
 *
 * Scope, deliberately: this restricts kind='mcp' SESSIONS only. An interactive browser
 * session is untouched — staff must still be able to open payroll in the app.
 */

import { describe, expect, it } from 'vitest';

import { isDeniedAreaViolation, deniedAreaFor } from '../mcpDeniedAreas';
import type { AuthUser } from '../types';

const mcpUser = { sessionKind: 'mcp' } as AuthUser;
const browserUser = { sessionKind: 'session' } as AuthUser;

describe('isDeniedAreaViolation', () => {
  it('refuses a denied group for an MCP session', () => {
    expect(isDeniedAreaViolation(mcpUser, '/api/accounting/ledger')).toBe(true);
    expect(isDeniedAreaViolation(mcpUser, '/api/staff/list')).toBe(true);
    expect(isDeniedAreaViolation(mcpUser, '/api/my/payslips')).toBe(true);
  });

  it('refuses a hyphenated sibling of a denied group', () => {
    // `staff` must also cover `staff-documents` — routes are flattened, so one logical
    // area spreads across sibling group names.
    expect(isDeniedAreaViolation(mcpUser, '/api/staff-documents/1')).toBe(true);
  });

  it('refuses a denied PATH without denying its group', () => {
    // /api/field/attendance is denied; the rest of `field` and all of `field-stock` are
    // legitimate. Denying the group would remove the whole warehouse module.
    expect(isDeniedAreaViolation(mcpUser, '/api/field/attendance')).toBe(true);
    expect(isDeniedAreaViolation(mcpUser, '/api/field/workers')).toBe(false);
    expect(isDeniedAreaViolation(mcpUser, '/api/field-stock/reports/daily')).toBe(false);
  });

  it('ALLOWS a legitimate path for an MCP session', () => {
    // The mirror. Without it, a guard that refused everything would satisfy every
    // assertion above while breaking the entire connector.
    expect(isDeniedAreaViolation(mcpUser, '/api/reporting/meetings')).toBe(false);
    expect(isDeniedAreaViolation(mcpUser, '/api/projects')).toBe(false);
    expect(isDeniedAreaViolation(mcpUser, '/api/reporting/attendance?since=2026-01-01')).toBe(false);
  });

  it('does NOT restrict an interactive browser session', () => {
    // The whole point of scoping this to kind='mcp': staff open payroll in the app every
    // day. A guard that caught browser sessions would take the product down.
    expect(isDeniedAreaViolation(browserUser, '/api/accounting/ledger')).toBe(false);
    expect(isDeniedAreaViolation(browserUser, '/api/my/payslips')).toBe(false);
  });

  describe('shapes that must not walk around the check', () => {
    it('ignores the query string', () => {
      expect(isDeniedAreaViolation(mcpUser, '/api/accounting/ledger?year=2026')).toBe(true);
    });

    it('ignores a query string containing an ENCODED PERCENT', () => {
      // The first version decoded the whole URL before splitting on "?", so
      // `?search=80%25` became `?search=80%`, and the next decode iteration hit a bare
      // "%" and threw — refusing a permitted route because a user typed a percent sign
      // into a search box. The original "ignores the query string" case above passed
      // only because its query had nothing left to decode.
      expect(isDeniedAreaViolation(mcpUser, '/api/reporting/meetings?search=80%25')).toBe(false);
      expect(isDeniedAreaViolation(mcpUser, '/api/reporting/meetings?q=a%2Bb%26c')).toBe(false);
      // …and a denied area stays denied however odd its query is.
      expect(isDeniedAreaViolation(mcpUser, '/api/staff/list?q=100%25')).toBe(true);
    });

    it('allows real storage keys as path segments', () => {
      // Five catalogued catch-alls carry storage keys as PATH segments, and 20,999 of
      // 98,462 live keys contain spaces or parentheses. An over-strict shape rule here
      // is an outage, not a hole: it would 403 a fifth of the photo library on a
      // permitted route.
      expect(isDeniedAreaViolation(
        mcpUser,
        '/api/activate/photo/mamelodi/MAM.P.B416/WhatsApp%20Image%202026-03-18%20at%203.17.46%20PM%20(1).jpeg',
      )).toBe(false);
      expect(isDeniedAreaViolation(mcpUser, '/api/uploads/a b/c(1).jpg')).toBe(false);
      // The group segment stays strict — that is the part the decision is made on.
      expect(isDeniedAreaViolation(mcpUser, '/api/staff /list')).toBe(true);
    });

    it('is case-insensitive', () => {
      // Next.js route matching is case-sensitive, so /api/Accounting 404s today — but the
      // guard must not depend on that staying true.
      expect(isDeniedAreaViolation(mcpUser, '/api/Accounting/ledger')).toBe(true);
      expect(isDeniedAreaViolation(mcpUser, '/api/STAFF/list')).toBe(true);
    });

    it('collapses dot segments', () => {
      // The bypass found in the Python guard: /api/./staff computes group "." and slips
      // past a literal comparison.
      expect(isDeniedAreaViolation(mcpUser, '/api/./staff/list')).toBe(true);
      expect(isDeniedAreaViolation(mcpUser, '/api/field/./attendance')).toBe(true);
    });

    it('decodes percent-escapes, repeatedly', () => {
      expect(isDeniedAreaViolation(mcpUser, '/api/%73taff/list')).toBe(true);
      expect(isDeniedAreaViolation(mcpUser, '/api/%2573taff/list')).toBe(true);
    });

    it('is not defeated by a trailing byte', () => {
      // Any trailing byte that is not "/" defeated the literal comparison in the Python
      // guard. The group is taken from the SEGMENT, so these resolve to `staff` anyway.
      expect(isDeniedAreaViolation(mcpUser, '/api/staff /list')).toBe(true);
      expect(isDeniedAreaViolation(mcpUser, '/api/staff./list')).toBe(true);
      expect(isDeniedAreaViolation(mcpUser, '/api/staff\u0000/list')).toBe(true);
    });

    it('refuses a traversal rather than resolving it', () => {
      // Resolving `..` would silently accept /api/reporting/../staff/list.
      expect(isDeniedAreaViolation(mcpUser, '/api/reporting/../staff/list')).toBe(true);
    });

    it('fails closed on a path it cannot parse', () => {
      // An unparseable path is not proof of innocence. For an MCP session the safe
      // answer is refusal.
      expect(isDeniedAreaViolation(mcpUser, '')).toBe(true);
      expect(isDeniedAreaViolation(mcpUser, undefined)).toBe(true);
      expect(isDeniedAreaViolation(mcpUser, 'not-a-path')).toBe(true);
    });

    it('still lets a browser session through an unparseable path', () => {
      // Fail-closed applies to MCP only — a malformed URL on a browser session is the
      // router's problem, not an auth decision.
      expect(isDeniedAreaViolation(browserUser, '')).toBe(false);
    });
  });

  describe('deniedAreaFor names what was refused', () => {
    it('distinguishes UNPARSEABLE from permitted', () => {
      // It fails OPEN where isDeniedAreaViolation fails closed: both return a falsy
      // "nothing matched" for a path that cannot be parsed. It has no production caller
      // today, but the obvious next use — naming the area in the 403 body, or the
      // catalogue generator adopting it — would silently allow.
      expect(deniedAreaFor('not-a-path')).toBe('unparseable');
      expect(deniedAreaFor('')).toBe('unparseable');
      expect(deniedAreaFor('/api/reporting/meetings')).toBeUndefined();
    });

    it('returns the group or path that matched', () => {
      expect(deniedAreaFor('/api/accounting/ledger')).toBe('accounting');
      expect(deniedAreaFor('/api/staff-documents/1')).toBe('staff');
      expect(deniedAreaFor('/api/field/attendance')).toBe('/api/field/attendance');
    });

    it('returns undefined for an allowed path', () => {
      expect(deniedAreaFor('/api/reporting/meetings')).toBeUndefined();
    });
  });
});
