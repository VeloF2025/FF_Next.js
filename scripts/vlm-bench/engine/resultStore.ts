// scripts/vlm-bench/engine/resultStore.ts
import type { RunResult } from '../types';

/**
 * Persists a run. Uses a dynamic import of @/lib/db-pool AFTER env is loaded
 * (neon() cannot reach Supabase from tsx; db-pool wraps pg.Pool which can).
 * Stores only per-pack summaries (not per-case) in pack_scores.
 */
export async function storeRun(r: RunResult): Promise<number> {
  const { query } = await import('@/lib/db-pool');
  const summaries = r.packs.map(({ cases: _cases, ...summary }) => summary);
  const rows = (await query(
    `INSERT INTO vlm_bench_runs (mode, model, git_sha, status, started_at, pack_scores, live_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [r.mode, r.model, r.gitSha, r.status, r.startedAt, JSON.stringify(summaries), null],
  )) as Array<{ id: number }>;
  return rows[0].id;
}
