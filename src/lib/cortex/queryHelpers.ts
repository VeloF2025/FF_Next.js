/** Shared Cortex bridge query helpers — the citation wire type + limit clamping,
 *  used by BOTH /api/cortex/query (raw retrieval) and /api/cortex/answer (grounded
 *  answer). Lives in lib (not in a route file) so neither route depends on the other. */

/** Mirrors the bridge envelope (apps/bridge/routes/query.py :: Citation). Fields
 *  after source_id are always serialised by the bridge but can be empty. */
export interface Citation {
  n: number;
  source: string;
  source_id: string;
  channel?: string;
  author?: string;
  timestamp?: string;
  score?: number;
  snippet?: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

/** Clamp a raw ?limit value to [1, MAX_LIMIT], defaulting on garbage. */
export function clampLimit(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}
