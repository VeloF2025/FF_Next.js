// scripts/vlm-bench/snapFewshot.ts
// Snapshot production's civil few-shot block to a file so it can be pinned.
//
// vlmLearningService.getVlmFewShotExamples() uses neon(), which cannot reach
// Supabase outside webpack, so this reproduces its query over pg and then calls
// the REAL buildVlmFewShotPrompt. Deviation: the context-similarity re-sort is
// not reproduced — it only reorders the 6 fetched rows and its scorer is not
// exported. Ordering within the top 3 may therefore differ from production.
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { buildVlmFewShotPrompt } from '@/services/vlmLearningService';
import { selectRows } from './harvest/db';
import { closeHarvestPool } from './harvest';

const MAX = 3;

(async () => {
  const rows = await selectRows<{
    vlm_extracted_value: string;
    corrected_value: string;
    correction_notes: string | null;
    error_pattern: string | null;
  }>(
    `SELECT vlm_extracted_value, corrected_value, correction_notes, error_pattern
     FROM vlm_corrections
     WHERE module = $1 AND analysis_type = $2 AND corrected_value IS NOT NULL
     ORDER BY is_canonical DESC, priority DESC, created_at DESC
     LIMIT $3`,
    ['construction_qa', 'construction_photo_qa', MAX * 2],
  );
  const section = buildVlmFewShotPrompt(
    rows.slice(0, MAX).map((r) => ({
      incorrect: r.vlm_extracted_value,
      correct: r.corrected_value,
      context: r.correction_notes ?? undefined,
      errorPattern: (r.error_pattern ?? undefined) as never,
    })),
    'markdown',
  );
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
