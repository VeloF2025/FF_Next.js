/**
 * Best-effort `last_used_at` tracking for MCP sessions.
 *
 * Fire-and-forget by design: this runs on the hot path of every authenticated request
 * and must NEVER raise into request handling or add latency. Throttled in SQL to at
 * most one write per session per 5 minutes, so a chatty MCP client does not turn every
 * read into a write.
 *
 * Reuses the existing pool — the Supabase connection budget is shared across all
 * fibreflow_user pools, so this module must not create its own.
 */
import { db } from '@/lib/db';
import { log } from '@/lib/logger';
import type { SessionKind } from './types';

const LOGGER = 'SessionUsage';

export function touchSessionUsage(sessionId: string, kind: SessionKind): void {
  if (kind !== 'mcp') return;

  void db
    .query(
      `UPDATE user_sessions
          SET last_used_at = NOW()
        WHERE id = $1
          AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '5 minutes')`,
      [sessionId]
    )
    .catch((err: unknown) => {
      // warn, not debug. This repo's logger only emits info/debug when LOG_STDOUT=true,
      // so a debug line here is invisible in production — and "best-effort" is exactly
      // the excuse under which a permanently-failing write goes unnoticed for months.
      // The logger's own comment records a 2026-07-10 outage that stayed invisible for
      // three days for the same reason.
      //
      // Accepted cost: during a database outage this fires once per mcp request. That is
      // noise on top of an already-visible incident, which is the better failure than
      // silence during an invisible one.
      log.warn('last_used_at update failed (ignored)', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      }, LOGGER);
    });
}
