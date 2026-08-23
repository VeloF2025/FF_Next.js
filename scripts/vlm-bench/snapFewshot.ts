// scripts/vlm-bench/snapFewshot.ts
// Snapshot production's civil few-shot block to a file so it can be pinned.
//
// vlmLearningService.getVlmFewShotExamples() uses neon(), which cannot reach
// Supabase outside webpack, so this reproduces its query over pg and then calls
// the REAL buildVlmFewShotPrompt.
//
// DEVIATION: production re-sorts the fetched rows by
// (isCanonical, contextSimilarity, priority) BEFORE slicing the top 3, and its
// scorer is not exported. That re-sort happens before the slice, so in general
// it can change WHICH rows reach the prompt, not merely their order.
//
// This script takes SQL order instead. That is only equivalent when every
// fetched row ties on the sort keys — then the comparator returns 0 for every
// pair, the sort is stable, and SQL order survives. That tie currently holds
// (all canonical, all priority 10, all discipline 'civil'), so the shortcut is
// safe TODAY. assertTiedOnSortKeys below fails loudly the moment it stops
// holding, rather than letting the snapshot drift away from production
// silently.
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { buildVlmFewShotPrompt } from '@/services/vlmLearningService';
import { selectRows } from './harvest/db';
import { closeHarvestPool } from './harvest';

const MAX = 3;

interface Row {
  vlm_extracted_value: string;
  corrected_value: string;
  correction_notes: string | null;
  error_pattern: string | null;
  is_canonical: boolean;
  priority: number | null;
  context_json: Record<string, unknown> | null;
}

/**
 * The shortcut above is valid only while every candidate ties on the keys
 * production sorts by. Check it rather than assume it.
 */
function assertTiedOnSortKeys(rows: readonly Row[], context: Record<string, unknown>): void {
  const key = (r: Row): string =>
    JSON.stringify([
      r.is_canonical,
      r.priority ?? 0,
      // Stand-in for the unexported similarity scorer: it scores contextJson
      // against this context, so rows agreeing on every context key must score
      // the same. Rows differing on any of them may not.
      Object.keys(context).map((k) => (r.context_json ?? {})[k]),
    ]);
  const distinct = new Set(rows.map(key));
  if (distinct.size > 1) {
    throw new Error(
      `few-shot candidates no longer tie on production's sort keys ` +
        `(${distinct.size} distinct groups). SQL order is no longer equivalent to ` +
        `production's re-sort, so this snapshot would not match what production sends. ` +
        `Reproduce calculateContextSimilarity (export it from vlmLearningService) before trusting this.`,
    );
  }
}

(async () => {
  const context = { discipline: 'civil' };
  const rows = await selectRows<Row>(
    `SELECT vlm_extracted_value, corrected_value, correction_notes, error_pattern,
            is_canonical, priority, context_json
     FROM vlm_corrections
     WHERE module = $1 AND analysis_type = $2 AND corrected_value IS NOT NULL
     ORDER BY is_canonical DESC, priority DESC, created_at DESC
     LIMIT $3`,
    ['construction_qa', 'construction_photo_qa', MAX * 2],
  );
  assertTiedOnSortKeys(rows, context);
  const section = buildVlmFewShotPrompt(
    rows.slice(0, MAX).map((r) => ({
      incorrect: r.vlm_extracted_value,
      correct: r.corrected_value,
      context: r.correction_notes ?? undefined,
      errorPattern: (r.error_pattern ?? undefined) as never,
    })),
    'markdown',
  );
  // An empty section would make the fewshot pack byte-identical to the base
  // pack, collapsing the A/B to noise with no error anywhere. Refuse to write it.
  if (section.trim().length === 0) {
    throw new Error(
      `refusing to write an empty few-shot snapshot (${rows.length} rows fetched). ` +
        `An empty file makes civil-rep-fewshot identical to civil-rep and the A/B measures nothing.`,
    );
  }
  const out = path.join(__dirname, 'datasets/fewshot/civil.txt');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, section);
  process.stdout.write(
    `rows=${rows.length} used=${Math.min(MAX, rows.length)} bytes=${section.length} ` +
      `sha256=${crypto.createHash('sha256').update(section).digest('hex').slice(0, 16)}\n`,
  );
  process.stdout.write(`--- content ---\n${section}\n`);
  await closeHarvestPool();
  process.exit(0);
})();
