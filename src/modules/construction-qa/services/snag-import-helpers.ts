/**
 * Snag Import Helpers — per-snag pole resolution and repeat detection logic
 * extracted from import-pdf.ts to keep files under 300 lines.
 *
 * WORKING: Used only by pages/api/snags/import-pdf.ts
 */

import type { NeonQueryFunction } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { detectRepeats } from './snag-repeat-detector';
import type { Snag } from '../types/snag.types';

interface ProcessSnagParams {
  snag: Snag;
  projectId: string;
  reportId: string;
  poleRefs: string[] | null;
  sql: NeonQueryFunction<false, false>;
}

interface ProcessSnagResult {
  snag: Snag;
  autoResolved: boolean;
  isRepeat: boolean;
}

/**
 * After a snag is inserted, attempt pole auto-resolution and repeat detection.
 * Returns the final (possibly updated) snag record.
 */
export async function processSnagPostInsert({
  snag,
  projectId,
  reportId,
  poleRefs,
  sql,
}: ProcessSnagParams): Promise<ProcessSnagResult> {
  let resolvedSnag = snag;
  let autoResolved = false;

  // ── A. Auto-resolve poles by numeric suffix matching ──────
  if (poleRefs && poleRefs.length > 0) {
    const ref = poleRefs[0]!;
    const numeric = ref.match(/\d+/)?.[0];

    if (numeric) {
      const poleMatches = await sql`
        SELECT id, zone_id, pon_id
        FROM poles
        WHERE project_id = ${projectId}
          AND pole_number ILIKE ${'%' + numeric + '%'}
        LIMIT 2
      ` as Array<{ id: string; zone_id: string | null; pon_id: string | null }>;

      if (poleMatches.length === 1 && poleMatches[0]) {
        const pole = poleMatches[0];
        await sql`
          UPDATE snags
          SET
            pole_ids   = ARRAY[${pole.id}::uuid],
            zone_id    = ${pole.zone_id},
            pon_id     = ${pole.pon_id},
            updated_at = NOW()
          WHERE id = ${snag.id}
        `;
        autoResolved = true;
        log.info('SnagImportHelpers: pole auto-resolved', {
          snagId: snag.id,
          ref,
          poleId: pole.id,
        });

        // Refresh snag to get updated pole data
        const refreshed = await sql`
          SELECT * FROM snags WHERE id = ${snag.id}
        ` as Snag[];
        if (refreshed[0]) resolvedSnag = refreshed[0];
      } else {
        log.info('SnagImportHelpers: pole unresolved (ambiguous or no match)', {
          snagId: snag.id,
          ref,
          candidates: poleMatches.length,
        });
      }
    }
  }

  // ── B. Cross-report repeat detection ─────────────────────
  const repeatResult = await detectRepeats(
    {
      id: snag.id,
      project_id: projectId,
      category: snag.category,
      pole_references: resolvedSnag.pole_references,
      report_id: reportId,
    },
    sql
  );

  return {
    snag: resolvedSnag,
    autoResolved,
    isRepeat: repeatResult.isRepeat,
  };
}
