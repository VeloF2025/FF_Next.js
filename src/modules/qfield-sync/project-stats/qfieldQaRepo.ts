import { query } from '@/lib/db-pool';
import type { QaStats } from './types';

export type QueryRunner = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

const defaultRun: QueryRunner = query;

type SummaryRow = Record<string, unknown> & {
  total: string | number;
  pending: string | number;
  in_review: string | number;
  approved: string | number;
  rejected: string | number;
  escalated: string | number;
  overdue: string | number;
  needs_retake: string | number;
  completed_retake: string | number;
  my_queue: string | number;
};

type GroupRow = Record<string, unknown> & {
  key: string;
  count: string | number;
};

function count(value: string | number | undefined): number {
  return Number(value ?? 0);
}

function grouped(rows: GroupRow[]): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.key, count(row.count)]));
}

export async function getQaStats(
  qfieldProjectId: string,
  userEmail: string,
  run: QueryRunner = defaultRun,
): Promise<QaStats> {
  const [summaryRows, confidenceRows, workTypeRows, priorityRows] = await Promise.all([
    run<SummaryRow>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE workflow_status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE workflow_status = 'in_review')::int AS in_review,
         COUNT(*) FILTER (WHERE workflow_status = 'approved')::int AS approved,
         COUNT(*) FILTER (WHERE workflow_status = 'rejected')::int AS rejected,
         COUNT(*) FILTER (WHERE workflow_status = 'escalated')::int AS escalated,
         COUNT(*) FILTER (
           WHERE due_date < NOW() AND workflow_status IN ('pending', 'in_review')
         )::int AS overdue,
         COUNT(*) FILTER (
           WHERE needs_retake = TRUE AND retake_completed_at IS NULL
         )::int AS needs_retake,
         COUNT(*) FILTER (
           WHERE needs_retake = TRUE AND retake_completed_at IS NOT NULL
         )::int AS completed_retake,
         COUNT(*) FILTER (
           WHERE assigned_to = $2 AND workflow_status IN ('pending', 'in_review')
         )::int AS my_queue
       FROM qfield_photo_validations
       WHERE project_id::text = $1`,
      [qfieldProjectId, userEmail],
    ),
    run<GroupRow>(
      `SELECT
         CASE
           WHEN vlm_confidence IS NULL THEN 'not_validated'
           WHEN vlm_confidence >= 0.8 THEN 'high_confidence'
           WHEN vlm_confidence >= 0.6 THEN 'medium_confidence'
           ELSE 'low_confidence'
         END AS key,
         COUNT(*)::int AS count
       FROM qfield_photo_validations
       WHERE project_id::text = $1
       GROUP BY 1`,
      [qfieldProjectId],
    ),
    run<GroupRow>(
      `SELECT
         COALESCE(NULLIF(trim(work_type), ''), '<null>') AS key,
         COUNT(*)::int AS count
       FROM qfield_photo_validations
       WHERE project_id::text = $1
       GROUP BY 1`,
      [qfieldProjectId],
    ),
    run<GroupRow>(
      `SELECT
         COALESCE(NULLIF(trim(priority), ''), 'normal') AS key,
         COUNT(*)::int AS count
       FROM qfield_photo_validations
       WHERE project_id::text = $1
       GROUP BY 1`,
      [qfieldProjectId],
    ),
  ]);

  const summary = summaryRows[0];
  return {
    total: count(summary?.total),
    pending: count(summary?.pending),
    inReview: count(summary?.in_review),
    approved: count(summary?.approved),
    rejected: count(summary?.rejected),
    escalated: count(summary?.escalated),
    overdue: count(summary?.overdue),
    needsRetake: count(summary?.needs_retake),
    completedRetake: count(summary?.completed_retake),
    myQueue: count(summary?.my_queue),
    confidence: grouped(confidenceRows),
    byWorkType: grouped(workTypeRows),
    byPriority: grouped(priorityRows),
  };
}
