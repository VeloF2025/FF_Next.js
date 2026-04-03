/**
 * Snag Repeat Detector — Cross-report repeat finding detection.
 *
 * Algorithm (PRD §4.3):
 * For a newly created snag S, find existing snags E where:
 *   - Same project_id
 *   - Same category
 *   - Overlapping pole_references (E.pole_references && S.pole_references)
 *   - Status NOT IN ('verified', 'closed')
 *   - Different report_id
 *
 * If match found:
 *   - Set S.is_repeat = TRUE, S.repeat_of_snag_id = E.id
 *   - Increment E.repeat_count
 *   - If E.status = 'fixed' → set E.status = 'reopened', increment E.reopen_count
 *   - If E.repeat_count >= 3 → auto-escalate E.severity to 'critical'
 *
 * IMPORTANT: Uses explicit query branches — no conditional SQL fragments.
 * WORKING: Validated with array overlap operator (&&) on pole_references.
 */

import type { NeonQueryFunction } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

// ============================================================
// Types
// ============================================================

interface NewSnagInput {
  id: string;
  project_id: string;
  category: string;
  pole_references: string[] | null;
  report_id: string;
}

export interface RepeatDetectionResult {
  isRepeat: boolean;
  repeatOf: string | null;
}

interface ExistingSnagMatch {
  id: string;
  status: string;
  repeat_count: number;
}

// ============================================================
// Main detector function
// ============================================================

/**
 * Detect if a newly created snag repeats an existing open/assigned/in_progress/fixed finding.
 * Updates both the new snag and the matched existing snag if a repeat is found.
 *
 * @param newSnag - The just-created snag (must already exist in DB so UPDATE works)
 * @param sql     - Active Neon query function from the caller's connection scope
 * @returns Detection result indicating whether a repeat was found
 */
export async function detectRepeats(
  newSnag: NewSnagInput,
  sql: NeonQueryFunction<false, false>
): Promise<RepeatDetectionResult> {
  // No pole references → cannot detect repeats by pole overlap
  if (!newSnag.pole_references || newSnag.pole_references.length === 0) {
    log.info('SnagRepeatDetector: no pole_references, skipping', { snagId: newSnag.id });
    return { isRepeat: false, repeatOf: null };
  }

  // Find existing snags with overlapping pole_references in the same project+category
  // Using explicit single query — no conditional SQL fragments.
  // The && operator is a Postgres array overlap expression, not a conditional fragment.
  const matches = await sql`
    SELECT id, status, repeat_count
    FROM snags
    WHERE project_id     = ${newSnag.project_id}
      AND category       = ${newSnag.category}
      AND report_id     <> ${newSnag.report_id}
      AND status NOT IN ('verified', 'closed')
      AND pole_references && ${newSnag.pole_references}
    ORDER BY created_at DESC
    LIMIT 1
  ` as ExistingSnagMatch[];

  if (matches.length === 0) {
    return { isRepeat: false, repeatOf: null };
  }

  const existing = matches[0]!;
  const newRepeatCount = existing.repeat_count + 1;
  const shouldEscalate = newRepeatCount >= 3;

  // Mark new snag as a repeat
  await sql`
    UPDATE snags
    SET
      is_repeat        = TRUE,
      repeat_of_snag_id = ${existing.id},
      updated_at       = NOW()
    WHERE id = ${newSnag.id}
  `;

  // Update the existing snag based on its current status
  if (existing.status === 'fixed') {
    // Was fixed but now recurs → reopen + escalate if threshold met
    if (shouldEscalate) {
      await sql`
        UPDATE snags
        SET
          repeat_count  = ${newRepeatCount},
          reopen_count  = reopen_count + 1,
          status        = 'reopened',
          severity      = 'critical',
          updated_at    = NOW()
        WHERE id = ${existing.id}
      `;
    } else {
      await sql`
        UPDATE snags
        SET
          repeat_count  = ${newRepeatCount},
          reopen_count  = reopen_count + 1,
          status        = 'reopened',
          updated_at    = NOW()
        WHERE id = ${existing.id}
      `;
    }
  } else {
    // Still open/assigned/in_progress — just increment repeat_count (+ escalate if needed)
    if (shouldEscalate) {
      await sql`
        UPDATE snags
        SET
          repeat_count  = ${newRepeatCount},
          severity      = 'critical',
          updated_at    = NOW()
        WHERE id = ${existing.id}
      `;
    } else {
      await sql`
        UPDATE snags
        SET
          repeat_count  = ${newRepeatCount},
          updated_at    = NOW()
        WHERE id = ${existing.id}
      `;
    }
  }

  log.info('SnagRepeatDetector: repeat detected', {
    newSnagId: newSnag.id,
    existingSnagId: existing.id,
    existingStatus: existing.status,
    newRepeatCount,
    escalated: shouldEscalate,
  });

  return { isRepeat: true, repeatOf: existing.id };
}
