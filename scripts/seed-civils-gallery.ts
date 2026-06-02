/**
 * Seed vlm_visual_photo_examples with civil construction QA photos.
 *
 * Uses construction_qa_photos joined to construction_qa_reviews to find
 * positive and negative examples for each of the 8 civil checklist steps.
 *
 * Rules:
 *   Positive: qa_decision = 'PASS' AND vlm_valid = true
 *   Negative: qa_decision = 'RETAKE' AND vlm_valid = false
 *   Max 6 per step per label, ordered by vlm_confidence DESC.
 *
 * Usage:
 *   DATABASE_URL='postgresql://...' npx tsx scripts/seed-civils-gallery.ts
 */

import { Pool } from 'pg';
import { isAllowedPhotoUrl } from '../src/lib/vfStoragePhotoUrl';

// ---------------------------------------------------------------------------
// Step definitions: canonical labels per step (noise labels are excluded)
// ---------------------------------------------------------------------------

interface StepDef {
  stepNumber: number;
  labels: string[];
}

const CIVIL_STEPS: StepDef[] = [
  {
    stepNumber: 1,
    labels: ['Before Photo', '1 - Before Photo'],
  },
  {
    stepNumber: 2,
    labels: ['During Photo'],
  },
  {
    stepNumber: 3,
    labels: ['Depth Photo'],
  },
  {
    stepNumber: 4,
    labels: ['End Plates', '4 - End Plates'],
  },
  {
    stepNumber: 5,
    labels: ['Compaction', 'Compaction / Backfill', '5 - Compaction / Backfill'],
  },
  {
    stepNumber: 6,
    labels: ['Level Check'],
  },
  {
    stepNumber: 7,
    labels: ['After Photo', '7 - After Photo', 'AFTER photo'],
  },
  {
    stepNumber: 8,
    labels: ['Signature'],
  },
];

const MAX_PER_LABEL = 6;

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Return up to MAX_PER_LABEL photos for a step + label type from the DB. */
async function fetchPhotos(
  pool: Pool,
  stepNumber: number,
  labels: string[],
  decision: 'PASS' | 'RETAKE',
  vlmValid: boolean
): Promise<Array<{ storage_url: string; vlm_confidence: string | null }>> {
  const res = await pool.query<{ storage_url: string; vlm_confidence: string | null }>(
    `
    SELECT p.storage_url, p.vlm_confidence
    FROM construction_qa_photos p
    JOIN construction_qa_reviews r ON r.id = p.review_id
    WHERE r.qa_decision  = $1
      AND p.vlm_valid    = $2
      AND p.checklist_step = $3
      AND p.step_label   = ANY($4::text[])
      AND p.storage_url  IS NOT NULL
      AND p.storage_url  != ''
    ORDER BY p.vlm_confidence DESC NULLS LAST
    LIMIT $5
    `,
    [decision, vlmValid, stepNumber, labels, MAX_PER_LABEL]
  );
  return res.rows;
}

/** Insert a photo example, skipping on conflict (idempotent). */
async function insertExample(
  pool: Pool,
  stepNumber: number,
  photoUrl: string,
  label: 'positive' | 'negative',
  confidence: string | null
): Promise<boolean> {
  // Defence-in-depth: never persist a photo_url the gallery loader would later
  // fetch server-side unless it is a trusted VF Storage origin.
  if (!isAllowedPhotoUrl(photoUrl)) {
    // eslint-disable-next-line no-console
    console.warn(`  ! skipping non-VF-Storage url: ${photoUrl}`);
    return false;
  }
  const res = await pool.query(
    `
    INSERT INTO vlm_visual_photo_examples
      (job_type, step_number, photo_url, label, confidence)
    VALUES
      ('civils', $1, $2, $3, $4)
    ON CONFLICT (photo_url) DO NOTHING
    `,
    [stepNumber, photoUrl, label, confidence ?? null]
  );
  return (res.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    // eslint-disable-next-line no-console
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });

  // eslint-disable-next-line no-console
  console.log('=== Seeding civils gallery examples ===\n');

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const step of CIVIL_STEPS) {
    // eslint-disable-next-line no-console
    console.log(`Step ${step.stepNumber} — labels: [${step.labels.join(', ')}]`);

    // Positive examples (PASS + vlm_valid = true)
    const positivePhotos = await fetchPhotos(pool, step.stepNumber, step.labels, 'PASS', true);
    let posInserted = 0;
    let posSkipped = 0;
    for (const photo of positivePhotos) {
      const inserted = await insertExample(pool, step.stepNumber, photo.storage_url, 'positive', photo.vlm_confidence);
      if (inserted) posInserted++;
      else posSkipped++;
    }

    // Negative examples (RETAKE + vlm_valid = false)
    const negativePhotos = await fetchPhotos(pool, step.stepNumber, step.labels, 'RETAKE', false);
    let negInserted = 0;
    let negSkipped = 0;
    for (const photo of negativePhotos) {
      const inserted = await insertExample(pool, step.stepNumber, photo.storage_url, 'negative', photo.vlm_confidence);
      if (inserted) negInserted++;
      else negSkipped++;
    }

    // eslint-disable-next-line no-console
    console.log(
      `  positive: ${posInserted} inserted, ${posSkipped} skipped (${positivePhotos.length} found)`
    );
    // eslint-disable-next-line no-console
    console.log(
      `  negative: ${negInserted} inserted, ${negSkipped} skipped (${negativePhotos.length} found)`
    );

    totalInserted += posInserted + negInserted;
    totalSkipped += posSkipped + negSkipped;
  }

  // eslint-disable-next-line no-console
  console.log(`\nDone. Total inserted: ${totalInserted}, skipped (already existed): ${totalSkipped}`);

  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', err);
  process.exit(1);
});
