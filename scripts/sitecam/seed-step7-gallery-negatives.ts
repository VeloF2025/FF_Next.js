/**
 * Seed curated NEGATIVE gallery examples for Step 7 (Power Meter Reading).
 *
 * Step 7 had 60 curated positives but ZERO negatives, so the auto-QA visual
 * step-quality check (stepQualityValidationService -> loadGalleryExamples) had
 * no "reject" anchors for power-meter photos. This seeds six hand-vetted
 * negatives — each visually confirmed (not trusted from a DR-level qa_decision,
 * which is per-DR, not per-photo).
 *
 * IMPORTANT scope: these are VISUAL / wrong-subject / illegibility failures —
 * the only thing the gallery check judges. Out-of-range-but-readable meters are
 * deliberately NOT seeded here: the dBm range (-24..-18) is enforced
 * deterministically by validatePowerMeter()/checkPowerMeterRange() on the
 * extracted reading, never by visual few-shot. Teaching the VLM to "reject" a
 * legible meter would fight that gate and hurt recall.
 *
 * Mirrors pages/api/activate/photo-gallery/save-decisions.ts exactly (the path a
 * manager's "bad" click takes): dual-writes vlm_corrections (text few-shot) +
 * vlm_visual_photo_examples (image few-shot), computes phash best-effort.
 * Idempotent — re-running updates in place (ON CONFLICT / SELECT-then-UPDATE).
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/sitecam/seed-step7-gallery-negatives.ts [--dry]
 */
/* eslint-disable no-console -- CLI tool, console is the output channel */

import pool from '@/lib/db';
import { fetchPhotoAsBase64 } from '@/modules/activate/services/photoFetchService';
import { resolveInternalPhotoUrl } from '@/lib/internalPhotoUrl';
import { computeDHash } from '@/lib/imageHash';
import { STEP_LABELS } from '@/modules/activate/components/photo-gallery/types';

const STEP = 7;

interface SeedPhoto {
  drNumber: string;
  filename: string;
  confidence: number;
  /** Why this is a valid Step-7 visual negative (recorded in correction_notes). */
  reason: string;
}

/**
 * Six hand-vetted Step-7 negatives (visually inspected 2026-06-29). All were
 * categorized as Step 7 but are clear rejects on subject/legibility grounds.
 */
const NEGATIVES: SeedPhoto[] = [
  { drNumber: 'DR474351', filename: 'DR474351_ph_powm2_4828498.jpg', confidence: 0.1,
    reason: 'Wrong subject — Nokia ONT box label (upside down), not a power meter' },
  { drNumber: 'DR471751', filename: 'DR471751_ph_powm2_6477191.jpg', confidence: 0.45,
    reason: 'Illegible — real meter but far too dark/grainy to read the dBm value' },
  { drNumber: 'DR1864985', filename: 'DR1864985_ph_wall_5127408.jpg', confidence: 0.1,
    reason: 'No subject — out-of-focus blank close-up, no meter visible' },
  { drNumber: 'DR1862787', filename: 'DR1862787_ph_after_4682517.jpg', confidence: 0.1,
    reason: 'Wrong subject — Nokia battery box spec sheet, not a meter reading' },
  { drNumber: 'DR1853456', filename: 'DR1853456_ph_wall_2548043.jpg', confidence: 0.1,
    reason: 'No content — completely black frame (lens covered)' },
  { drNumber: 'DR1730564', filename: 'DR1730564_ph_after_3945593.jpg', confidence: 0.35,
    reason: 'Wrong device — dirty multi-plug power strip, not an optical power meter' },
];

function photoUrl(p: SeedPhoto): string {
  return `/api/activate/photo/${p.drNumber}/${p.filename}`;
}

/** Upsert the text few-shot row (vlm_corrections) — bad => reject, priority 10. */
async function upsertCorrection(url: string, p: SeedPhoto, stepName: string): Promise<void> {
  const notes = `Gallery: bad/reject example — step ${STEP} (${stepName}). ${p.reason}`;
  const contextJson = JSON.stringify({
    drNumber: p.drNumber, filename: p.filename, stepNumber: STEP, stepName,
  });
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM vlm_corrections
      WHERE photo_url = $1 AND module = 'activate' AND analysis_type = 'photo_categorization'
      LIMIT 1`,
    [url],
  );
  if ((existing.rowCount ?? 0) > 0) {
    await pool.query(
      `UPDATE vlm_corrections SET
         source_table = 'gallery', vlm_extracted_value = $1, corrected_value = 'reject',
         error_pattern = 'poor_quality_example', correction_notes = $2, context_json = $3::jsonb,
         is_canonical = false, priority = 10
       WHERE id = $4`,
      [`step_${STEP}`, notes, contextJson, existing.rows[0].id],
    );
  } else {
    await pool.query(
      `INSERT INTO vlm_corrections (
         module, analysis_type, source_table, photo_url,
         vlm_extracted_value, corrected_value, error_pattern, correction_notes,
         context_json, is_canonical, priority
       ) VALUES (
         'activate', 'photo_categorization', 'gallery', $1,
         $2, 'reject', 'poor_quality_example', $3, $4::jsonb, false, 10
       )`,
      [url, `step_${STEP}`, notes, contextJson],
    );
  }
}

/** Upsert the image few-shot row (vlm_visual_photo_examples) — label negative. */
async function upsertVisual(url: string, p: SeedPhoto, phash: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO vlm_visual_photo_examples
       (step_number, photo_url, label, dr_number, filename, confidence, phash, job_type)
     VALUES ($1, $2, 'negative', $3, $4, $5, $6, 'activation')
     ON CONFLICT (photo_url) DO UPDATE SET
       step_number = EXCLUDED.step_number, label = EXCLUDED.label,
       dr_number = EXCLUDED.dr_number, filename = EXCLUDED.filename,
       confidence = EXCLUDED.confidence,
       phash = COALESCE(EXCLUDED.phash, vlm_visual_photo_examples.phash)`,
    [STEP, url, p.drNumber, p.filename, p.confidence, phash],
  );
}

async function main(): Promise<void> {
  const dry = process.argv.slice(2).includes('--dry');
  const stepName = STEP_LABELS[STEP] ?? `Step ${STEP}`;
  console.log(`Seeding ${NEGATIVES.length} Step-${STEP} (${stepName}) gallery negatives${dry ? ' (dry run — no writes)' : ''}\n`);

  let saved = 0, hashFail = 0, writeFail = 0;
  for (const p of NEGATIVES) {
    const url = photoUrl(p);
    let phash: string | null = null;
    try {
      phash = await computeDHash(await fetchPhotoAsBase64(resolveInternalPhotoUrl(url)));
    } catch (err) {
      hashFail++;
      console.log(`  phash skipped (will backfill) ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!dry) {
      // Isolate each photo's writes (mirrors save-decisions.ts per-decision try/catch):
      // a DB error on one negative must not abort the remaining seeds.
      try {
        await upsertCorrection(url, p, stepName);
        await upsertVisual(url, p, phash);
      } catch (err) {
        writeFail++;
        console.error(`  WRITE FAILED ${url}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }
    saved++;
    console.log(`  ${dry ? 'WOULD SEED' : 'SEEDED'} [negative]${phash ? '' : ' (no phash)'} ${url}\n      ↳ ${p.reason}`);
  }

  console.log(`\nDone. ${dry ? 'Would seed' : 'Seeded'}: ${saved}/${NEGATIVES.length}  phash failures: ${hashFail}  write failures: ${writeFail}`);
  await pool.end();
  process.exit(writeFail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
