/**
 * Read-only gate for MCP sessions.
 *
 * An MCP token is a long-lived credential pasted into a third-party client, so it is
 * restricted to safe methods. The gate lives in withAuth/requireAuth rather than in
 * individual routes: every existing and future endpoint inherits it, and no route can
 * forget to apply it.
 *
 * Fails closed — anything not explicitly a safe method is a violation.
 */
import type { AuthUser } from './types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const MCP_READ_ONLY_CODE = 'MCP_READ_ONLY';
export const MCP_READ_ONLY_MESSAGE =
  'This token is read-only. Mutating requests require an interactive FibreFlow session.';

export function isReadOnlyViolation(user: AuthUser, method: string | undefined): boolean {
  if (user.sessionKind !== 'mcp') return false;
  return !SAFE_METHODS.has((method ?? 'GET').toUpperCase());
}
