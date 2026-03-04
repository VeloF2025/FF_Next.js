#!/usr/bin/env tsx
/**
 * Backfill captured_at for QField photos from filename timestamps.
 *
 * QField filenames encode the capture time:
 *   law-poles_20251120145759971.JPG → 2025-11-20T14:57:59.971Z
 *
 * This script:
 *   1. Finds all construction_qa_photos WHERE source='qfield' AND captured_at IS NULL
 *   2. Parses capture date from storage_key filename
 *   3. Batch UPDATEs captured_at
 *   4. Updates construction_qa_reviews.last_photo_at to the EARLIEST captured_at per review
 *
 * Usage:
 *   npx tsx scripts/backfill-photo-captured-at.ts          # dry run
 *   npx tsx scripts/backfill-photo-captured-at.ts --apply   # execute
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const BATCH_SIZE = 500;
const applyMode = process.argv.includes('--apply');

/** QField filename pattern: _YYYYMMDDHHMMSSmmm.ext (filename is mid-path, not last segment) */
const QF_TS_RE = /_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})?\.(?:jpg|jpeg|png|gif|webp|heic)/i;

function parseCaptureDateFromKey(storageKey: string): Date | null {
  const m = QF_TS_RE.exec(storageKey);
  if (!m) return null;

  const [, year, month, day, hour, min, sec, ms] = m;
  const iso = `${year}-${month}-${day}T${hour}:${min}:${sec}.${ms || '000'}Z`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  console.log(`\n=== Backfill captured_at for QField photos ===`);
  console.log(`Mode: ${applyMode ? 'APPLY (writing to DB)' : 'DRY RUN (read-only)'}\n`);

  // Step 1: Find photos needing backfill
  const photos = await sql`
    SELECT id, storage_key
    FROM construction_qa_photos
    WHERE source = 'qfield' AND captured_at IS NULL
    ORDER BY id
  `;

  console.log(`Found ${photos.length} QField photos with NULL captured_at`);

  if (photos.length === 0) {
    console.log('Nothing to backfill. Done.');
    return;
  }

  // Step 2: Parse dates from filenames
  let parsed = 0;
  let skipped = 0;
  const updates: { id: string; capturedAt: string }[] = [];

  for (const photo of photos) {
    const capturedAt = parseCaptureDateFromKey(photo.storage_key as string);
    if (capturedAt) {
      updates.push({ id: photo.id as string, capturedAt: capturedAt.toISOString() });
      parsed++;
    } else {
      skipped++;
    }
  }

  console.log(`Parsed: ${parsed}, Skipped (no pattern match): ${skipped}`);

  if (!applyMode) {
    // Show sample
    const sample = updates.slice(0, 5);
    console.log('\nSample updates:');
    for (const u of sample) {
      const photo = photos.find(p => p.id === u.id);
      console.log(`  ${(photo?.storage_key as string)?.split('/').pop()} → ${u.capturedAt}`);
    }
    console.log(`\nRun with --apply to execute ${updates.length} updates.`);
    return;
  }

  // Step 3: Batch update photos
  console.log(`\nUpdating ${updates.length} photos in batches of ${BATCH_SIZE}...`);
  let totalUpdated = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);

    // Build a VALUES list for batch update
    const values = batch.map((u, idx) => {
      const p1 = idx * 2 + 1;
      const p2 = idx * 2 + 2;
      return `($${p1}::uuid, $${p2}::timestamptz)`;
    }).join(', ');

    const params = batch.flatMap(u => [u.id, u.capturedAt]);

    const updateQuery = `
      UPDATE construction_qa_photos AS p
      SET captured_at = v.captured_at
      FROM (VALUES ${values}) AS v(id, captured_at)
      WHERE p.id = v.id
    `;

    await sql.query(updateQuery, params);
    totalUpdated += batch.length;
    console.log(`  Updated ${totalUpdated}/${updates.length}`);
  }

  // Step 4: Update reviews.last_photo_at to earliest photo captured_at
  console.log('\nUpdating review last_photo_at to earliest photo captured_at...');
  const reviewResult = await sql`
    UPDATE construction_qa_reviews r
    SET last_photo_at = sub.earliest_capture
    FROM (
      SELECT review_id, MIN(captured_at) AS earliest_capture
      FROM construction_qa_photos
      WHERE source = 'qfield' AND captured_at IS NOT NULL
      GROUP BY review_id
    ) sub
    WHERE r.id = sub.review_id
      AND (r.last_photo_at IS NULL OR r.last_photo_at > sub.earliest_capture)
  `;
  console.log(`  Updated ${reviewResult.length ?? 0} reviews`);

  // Step 5: Summary
  const verification = await sql`
    SELECT
      COUNT(*) FILTER (WHERE captured_at IS NOT NULL) AS with_date,
      COUNT(*) FILTER (WHERE captured_at IS NULL) AS without_date
    FROM construction_qa_photos
    WHERE source = 'qfield'
  `;
  const v = verification[0];
  console.log(`\nVerification: ${v?.with_date} with captured_at, ${v?.without_date} without`);
  console.log('Done.');
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
