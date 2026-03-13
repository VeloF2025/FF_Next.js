/**
 * Analyze VLM confusion patterns from vlm_corrections table.
 * Build a position-aware confusion matrix to inform post-hoc correction.
 *
 * Usage: npx tsx scripts/analyze-confusion-patterns.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log(`\n=== VLM Confusion Pattern Analysis ===\n`);

  // Get all corrections with serial data
  const corrections = await sql`
    SELECT vlm_extracted_value, corrected_value, error_pattern, context_json
    FROM vlm_corrections
    WHERE module = 'activate'
      AND analysis_type IN ('ont_serial_back', 'ont_serial_front')
      AND vlm_extracted_value IS NOT NULL
      AND corrected_value IS NOT NULL
  `;

  console.log(`Total corrections: ${corrections.length}\n`);

  // 1. Overall confusion matrix (char → char)
  const confusionMatrix: Record<string, Record<string, number>> = {};
  // 2. Position-specific confusion
  const positionConfusion: Record<number, Record<string, number>> = {};
  // 3. Position frequency (which positions have errors)
  const positionErrors: Record<number, number> = {};

  let sameLength = 0;
  let diffLength = 0;

  for (const c of corrections) {
    const vlm = c.vlm_extracted_value.trim().toUpperCase();
    const correct = c.corrected_value.trim().toUpperCase();

    if (vlm.length !== correct.length) {
      diffLength++;
      continue;
    }
    sameLength++;

    for (let i = 0; i < vlm.length; i++) {
      if (vlm[i] !== correct[i]) {
        // Overall confusion
        const key = `${vlm[i]}→${correct[i]}`;
        if (!confusionMatrix[vlm[i]]) confusionMatrix[vlm[i]] = {};
        confusionMatrix[vlm[i]][correct[i]] = (confusionMatrix[vlm[i]][correct[i]] || 0) + 1;

        // Position-specific
        if (!positionConfusion[i]) positionConfusion[i] = {};
        positionConfusion[i][key] = (positionConfusion[i][key] || 0) + 1;

        // Position frequency
        positionErrors[i] = (positionErrors[i] || 0) + 1;
      }
    }
  }

  console.log(`Same-length pairs: ${sameLength} | Different-length: ${diffLength}\n`);

  // Print position error frequency
  console.log(`--- Position Error Frequency (0-indexed) ---`);
  console.log(`(Positions 0-5 are "ALCLB4" prefix)\n`);
  for (const [pos, count] of Object.entries(positionErrors).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / sameLength) * 100).toFixed(1);
    console.log(`  Position ${pos.padStart(2)}: ${String(count).padStart(4)} errors (${pct}%) ${'█'.repeat(Math.round(count / 5))}`);
  }

  // Print top confusion pairs
  console.log(`\n--- Top Confusion Pairs (VLM reads X as Y) ---\n`);
  const allPairs: Array<{ from: string; to: string; count: number }> = [];
  for (const [from, tos] of Object.entries(confusionMatrix)) {
    for (const [to, count] of Object.entries(tos)) {
      allPairs.push({ from, to, count });
    }
  }
  allPairs.sort((a, b) => b.count - a.count);

  for (const { from, to, count } of allPairs.slice(0, 30)) {
    console.log(`  ${from}→${to}: ${String(count).padStart(4)}  ${'█'.repeat(Math.round(count / 3))}`);
  }

  // Print position-specific confusion for hex suffix (positions 6-11)
  console.log(`\n--- Position-Specific Confusion (suffix positions 6-11) ---\n`);
  for (let pos = 6; pos <= 11; pos++) {
    const pc = positionConfusion[pos];
    if (!pc) continue;

    const sorted = Object.entries(pc).sort((a, b) => b[1] - a[1]);
    console.log(`  Position ${pos}:`);
    for (const [pair, count] of sorted.slice(0, 5)) {
      console.log(`    ${pair}: ${count}`);
    }
  }

  // 4. Analyze: can we build a statistical corrector?
  console.log(`\n\n--- Statistical Corrector Feasibility ---\n`);

  // For each confusion pair, what's the correction rate?
  // i.e., if VLM says "8" at position 10, how often is it actually "B"?
  // We need the total count of correct "8"s vs corrected "8→B"

  // Get the distribution of correct characters at each suffix position
  const correctChars: Record<number, Record<string, number>> = {};
  for (const c of corrections) {
    const correct = c.corrected_value.trim().toUpperCase();
    if (correct.length !== 12 || !correct.startsWith('ALCLB4')) continue;
    for (let i = 6; i < 12; i++) {
      if (!correctChars[i]) correctChars[i] = {};
      correctChars[i][correct[i]] = (correctChars[i][correct[i]] || 0) + 1;
    }
  }

  console.log(`Character distribution at each suffix position (from OES ground truth):\n`);
  for (let pos = 6; pos <= 11; pos++) {
    const cc = correctChars[pos];
    if (!cc) continue;
    const total = Object.values(cc).reduce((s, n) => s + n, 0);
    const sorted = Object.entries(cc).sort((a, b) => b[1] - a[1]);
    console.log(`  Position ${pos}: ${sorted.slice(0, 6).map(([c, n]) => `${c}=${((n / total) * 100).toFixed(0)}%`).join(', ')}`);
  }

  // 5. Suggest: for ambiguous chars, what's the most likely correction?
  console.log(`\n\nSuggested post-hoc corrections (when VLM is unsure):\n`);
  const corrections_map: Array<{ pos: number; from: string; to: string; count: number; total: number }> = [];

  for (let pos = 6; pos <= 11; pos++) {
    const pc = positionConfusion[pos];
    if (!pc) continue;
    for (const [pair, count] of Object.entries(pc)) {
      const [from, to] = pair.split('→');
      // Only suggest if the confusion is common enough
      if (count >= 3) {
        corrections_map.push({ pos, from, to, count, total: positionErrors[pos] || 0 });
      }
    }
  }

  corrections_map.sort((a, b) => b.count - a.count);
  for (const { pos, from, to, count, total } of corrections_map.slice(0, 20)) {
    console.log(`  Position ${pos}: ${from}→${to} (${count}/${total} errors at this position, ${((count / total) * 100).toFixed(0)}%)`);
  }

  console.log(`\n${'='.repeat(70)}\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
