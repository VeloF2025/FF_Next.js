/**
 * Backfill VLM corrections from existing OES ground truth data.
 *
 * One-time script to populate vlm_corrections with historical
 * serial extraction errors, comparing VLM-extracted ONT serials
 * against OES-confirmed serials (source of truth).
 *
 * Usage:
 *   npx tsx scripts/backfill-vlm-corrections-from-oes.ts [--dry-run] [--limit N]
 *
 * This gives the VLM learning system thousands of labeled examples
 * to learn from, improving future serial extraction accuracy.
 */

import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.find((_, i, arr) => arr[i - 1] === '--limit');
const LIMIT = limitArg ? parseInt(limitArg, 10) : 0;

function classifySerialError(vlm: string, oes: string): string {
  if (vlm.length !== oes.length) return 'length_mismatch';

  let diffCount = 0;
  const diffs: string[] = [];
  for (let i = 0; i < vlm.length; i++) {
    if (vlm[i] !== oes[i]) {
      diffCount++;
      diffs.push(`${vlm[i]}->${oes[i]}`);
    }
  }

  if (diffCount === 1) {
    const pair = diffs[0];
    if (pair === '1->7' || pair === '7->1') return 'digit_1_7';
    if (pair === '1->6' || pair === '6->1') return 'digit_1_6';
    if (pair === '6->8' || pair === '8->6') return 'digit_6_8';
    if (pair === '8->0' || pair === '0->8') return 'digit_8_0';
    if (pair === '9->4' || pair === '4->9') return 'digit_9_4';
    if (pair === '2->3' || pair === '3->2') return 'digit_2_3';
    return `single_char_${diffCount}`;
  }

  if (diffCount <= 3) return `multi_char_${diffCount}`;
  return 'totally_wrong';
}

function errorPatternToReason(pattern: string): string {
  if (pattern.startsWith('digit_')) return 'digit_confusion';
  if (pattern === 'length_mismatch') return 'partial_extraction';
  return 'other';
}

async function main() {
  console.log(`\n=== Backfill VLM Corrections from OES ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  if (LIMIT) console.log(`Limit: ${LIMIT}`);

  // Get all DRs with both VLM serial and OES serial
  const query = `
    SELECT id, drop_number, oes_serial,
           vlm_ont_serial_step6, vlm_ont_serial_step9,
           serial_extraction_method_step6, serial_extraction_method_step9
    FROM dr_photo_unified_reviews
    WHERE oes_serial IS NOT NULL AND oes_serial != ''
      AND (vlm_ont_serial_step6 IS NOT NULL OR vlm_ont_serial_step9 IS NOT NULL)
    ${LIMIT ? `LIMIT ${LIMIT}` : ''}
  `;

  const rows = await sql.query(query);
  console.log(`Found ${rows.length} DRs with OES + VLM serials\n`);

  // Get existing corrections to avoid duplicates (by source_id UUID)
  const existingRows = await sql`
    SELECT source_id, analysis_type FROM vlm_corrections
    WHERE module = 'activate'
      AND analysis_type IN ('ont_serial_back', 'ont_serial_front')
      AND source_id IS NOT NULL
  `;
  const existingKeys = new Set(
    existingRows.map((r: Record<string, string>) =>
      `${r.source_id}:${r.analysis_type}`)
  );
  console.log(`Existing corrections: ${existingKeys.size} (will skip)\n`);

  const stats = {
    step6: { exact: 0, corrected: 0, skipped: 0 },
    step9: { exact: 0, corrected: 0, skipped: 0 },
    errorPatterns: {} as Record<string, number>,
  };

  const insertValues: Array<{
    analysisType: string;
    sourceId: string; // UUID from dr_photo_unified_reviews.id
    dropNumber: string;
    vlmValue: string;
    oesValue: string;
    errorPattern: string;
    reason: string;
    method: string;
  }> = [];

  for (const row of rows) {
    const oesSerial = row.oes_serial.trim().toUpperCase();

    // Step 6
    if (row.vlm_ont_serial_step6) {
      const vlm = row.vlm_ont_serial_step6.trim().toUpperCase();
      if (vlm === oesSerial) {
        stats.step6.exact++;
      } else if (existingKeys.has(`${row.id}:ont_serial_back`)) {
        stats.step6.skipped++;
      } else {
        const pattern = classifySerialError(vlm, oesSerial);
        stats.step6.corrected++;
        stats.errorPatterns[pattern] = (stats.errorPatterns[pattern] || 0) + 1;
        insertValues.push({
          analysisType: 'ont_serial_back',
          sourceId: row.id,
          dropNumber: row.drop_number,
          vlmValue: row.vlm_ont_serial_step6,
          oesValue: row.oes_serial,
          errorPattern: pattern,
          reason: errorPatternToReason(pattern),
          method: row.serial_extraction_method_step6 || 'vlm',
        });
      }
    }

    // Step 9
    if (row.vlm_ont_serial_step9) {
      const vlm = row.vlm_ont_serial_step9.trim().toUpperCase();
      if (vlm === oesSerial) {
        stats.step9.exact++;
      } else if (existingKeys.has(`${row.id}:ont_serial_front`)) {
        stats.step9.skipped++;
      } else {
        const pattern = classifySerialError(vlm, oesSerial);
        stats.step9.corrected++;
        stats.errorPatterns[pattern] = (stats.errorPatterns[pattern] || 0) + 1;
        insertValues.push({
          analysisType: 'ont_serial_front',
          sourceId: row.id,
          dropNumber: row.drop_number,
          vlmValue: row.vlm_ont_serial_step9,
          oesValue: row.oes_serial,
          errorPattern: pattern,
          reason: errorPatternToReason(pattern),
          method: row.serial_extraction_method_step9 || 'vlm',
        });
      }
    }
  }

  // Print stats
  console.log(`Step 6 (ONT Back):`);
  console.log(`  Exact match: ${stats.step6.exact}`);
  console.log(`  Corrections: ${stats.step6.corrected}`);
  console.log(`  Skipped:     ${stats.step6.skipped}`);
  const s6Total = stats.step6.exact + stats.step6.corrected + stats.step6.skipped;
  if (s6Total > 0) {
    console.log(`  Accuracy:    ${((stats.step6.exact / s6Total) * 100).toFixed(1)}%`);
  }

  console.log(`\nStep 9 (ONT Front):`);
  console.log(`  Exact match: ${stats.step9.exact}`);
  console.log(`  Corrections: ${stats.step9.corrected}`);
  console.log(`  Skipped:     ${stats.step9.skipped}`);
  const s9Total = stats.step9.exact + stats.step9.corrected + stats.step9.skipped;
  if (s9Total > 0) {
    console.log(`  Accuracy:    ${((stats.step9.exact / s9Total) * 100).toFixed(1)}%`);
  }

  console.log(`\nError patterns:`);
  const sorted = Object.entries(stats.errorPatterns).sort((a, b) => b[1] - a[1]);
  for (const [pattern, count] of sorted) {
    console.log(`  ${pattern}: ${count}`);
  }

  console.log(`\nTotal corrections to insert: ${insertValues.length}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No records inserted. Run without --dry-run to apply.');

    // Show sample corrections
    console.log('\nSample corrections:');
    for (const v of insertValues.slice(0, 10)) {
      console.log(`  ${v.dropNumber}: VLM="${v.vlmValue}" → OES="${v.oesValue}" (${v.errorPattern})`);
    }
  } else {
    // Batch insert
    const BATCH_SIZE = 100;
    let inserted = 0;

    for (let i = 0; i < insertValues.length; i += BATCH_SIZE) {
      const batch = insertValues.slice(i, i + BATCH_SIZE);

      // Insert one at a time using tagged templates (safe, no SQL injection)
      for (const v of batch) {
        const ctx = JSON.stringify({
          drop_number: v.dropNumber,
          error_pattern: v.errorPattern,
          extraction_method: v.method,
          source: 'oes_backfill',
        });
        const notes = `Auto-corrected from OES. Pattern: ${v.errorPattern}`;

        await sql`
          INSERT INTO vlm_corrections (
            module, analysis_type, source_id, source_table,
            vlm_extracted_value, corrected_value, error_pattern,
            correction_reason, correction_notes, context_json,
            corrected_by_name
          ) VALUES (
            'activate', ${v.analysisType}, ${v.sourceId}, 'dr_photo_unified_reviews',
            ${v.vlmValue}, ${v.oesValue}, ${v.errorPattern},
            ${v.reason}, ${notes}, ${ctx}::jsonb,
            'OES Backfill (automated)'
          )
        `;
      }

      inserted += batch.length;
      if (inserted % 500 === 0) {
        console.log(`  Inserted ${inserted}/${insertValues.length}...`);
      }
    }

    console.log(`\nDone! Inserted ${inserted} corrections into vlm_corrections.`);
  }

}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
