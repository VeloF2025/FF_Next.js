/**
 * Batch Auto-Approve VLM Photo Categorizations
 *
 * Two-part fix:
 * 1. Fixes ph_bl and ph_drop step mapping from Step 6 → Step 9 in existing JSONB data
 * 2. Auto-approves photos where VLM confidence >= threshold
 *
 * Usage:
 *   npx tsx scripts/batch-auto-approve-photos.ts                    # Dry run (default)
 *   npx tsx scripts/batch-auto-approve-photos.ts --apply            # Apply changes
 *   npx tsx scripts/batch-auto-approve-photos.ts --apply --limit 100  # Apply to first 100 DRs
 *   npx tsx scripts/batch-auto-approve-photos.ts --confidence 0.85  # Lower confidence threshold
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

// Parse CLI args
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 0;
const confIdx = args.indexOf('--confidence');
const CONFIDENCE_THRESHOLD = confIdx !== -1 ? parseFloat(args[confIdx + 1]) : 0.90;

// Photo types that were wrongly mapped to Step 6 — should be Step 9
const REMAP_TYPES: Record<string, number> = {
  ph_bl: 9,
  ph_drop: 9,
};

interface CatResult {
  photo_filename: string;
  vlm_predicted_step: number;
  vlm_predicted_category: string;
  vlm_confidence: number;
  vlm_identified_as: string;
  vlm_reasoning: string;
  original_type: string | null;
  original_step: number | null;
  human_approved: boolean | null;
  human_override_step: number | null;
  human_override_reason: string | null;
}

interface PhotoMeta {
  filename: string;
  step: number;
  url?: string;
  original_type?: string;
}

async function main() {
  console.log('=== Batch Auto-Approve VLM Photo Categorizations ===');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Confidence threshold: ${CONFIDENCE_THRESHOLD}`);
  if (limit > 0) console.log(`Limit: ${limit} DRs`);
  console.log('');

  const PAGE_SIZE = 500;
  let pageOffset = 0;
  let totalFetched = 0;
  const maxRows = limit > 0 ? limit : Infinity;

  let totalPhotos = 0;
  let remappedPhotos = 0;
  let autoApprovedPhotos = 0;
  let alreadyApprovedPhotos = 0;
  let lowConfidencePhotos = 0;
  let drsUpdated = 0;
  let newlyFullyApproved = 0;

  while (totalFetched < maxRows) {
    const fetchSize = Math.min(PAGE_SIZE, maxRows - totalFetched);

    const rows = await sql`
      SELECT drop_number, vlm_categorization_results, photos_metadata, vlm_categorization_status
      FROM dr_photo_unified_reviews
      WHERE vlm_categorization_results IS NOT NULL
        AND (vlm_categorization_status = 'categorized' OR vlm_categorization_status = 'approved')
      ORDER BY created_at DESC
      LIMIT ${fetchSize} OFFSET ${pageOffset}
    `;

    if (rows.length === 0) break;

    totalFetched += rows.length;
    pageOffset += rows.length;
    console.log(`Processing page... (${totalFetched} DRs fetched so far)`);

    for (const row of rows) {
      const dropNumber = row.drop_number;
      const catResults: CatResult[] = row.vlm_categorization_results || [];
      const photosMeta: PhotoMeta[] = row.photos_metadata || [];
      let changed = false;

      const updatedResults: CatResult[] = catResults.map((cr) => {
        totalPhotos++;
        const updated = { ...cr };

        // Part 1: Fix step mapping for ph_bl and ph_drop
        if (cr.original_type && REMAP_TYPES[cr.original_type] !== undefined) {
          const correctStep = REMAP_TYPES[cr.original_type];
          if (cr.original_step !== correctStep) {
            updated.original_step = correctStep;
            remappedPhotos++;
            changed = true;
          }
        }

        // Part 2: Auto-approve if not already approved and confidence is high enough
        if (cr.human_approved === true) {
          alreadyApprovedPhotos++;
          return updated;
        }

        if (cr.vlm_confidence >= CONFIDENCE_THRESHOLD) {
          updated.human_approved = true;
          updated.human_override_step = null;
          updated.human_override_reason = null;
          autoApprovedPhotos++;
          changed = true;
        } else {
          lowConfidencePhotos++;
        }

        return updated;
      });

      if (!changed) continue;

      // Rebuild photos_metadata with final step assignments
      const updatedPhotos: PhotoMeta[] = photosMeta.map((photo) => {
        const cr = updatedResults.find((r) => r.photo_filename === photo.filename);
        if (!cr) return photo;

        const finalStep = cr.human_override_step !== null
          ? cr.human_override_step
          : cr.vlm_predicted_step;

        return { ...photo, step: finalStep };
      });

      // Determine new status: if ALL photos are now approved, mark as 'approved'
      const allApproved = updatedResults.every((r) => r.human_approved === true);
      const newStatus = allApproved ? 'approved' : row.vlm_categorization_status;
      if (allApproved && row.vlm_categorization_status === 'categorized') {
        newlyFullyApproved++;
      }

      if (apply) {
        await sql`
          UPDATE dr_photo_unified_reviews
          SET
            vlm_categorization_results = ${JSON.stringify(updatedResults)}::jsonb,
            vlm_categorization_status = ${newStatus},
            vlm_approved_by = CASE WHEN ${newStatus} = 'approved' AND vlm_approved_by IS NULL THEN 'auto-approve-script' ELSE vlm_approved_by END,
            vlm_approved_at = CASE WHEN ${newStatus} = 'approved' AND vlm_approved_at IS NULL THEN NOW() ELSE vlm_approved_at END,
            photos_metadata = ${JSON.stringify(updatedPhotos.length > 0 ? updatedPhotos : photosMeta)}::jsonb,
            updated_at = NOW()
          WHERE drop_number = ${dropNumber}
        `;
      }

      drsUpdated++;
    }

    if (rows.length < fetchSize) break;
  }

  console.log('\n=== Results ===');
  console.log(`Total DRs scanned:        ${totalFetched}`);
  console.log(`Total photos scanned:     ${totalPhotos}`);
  console.log(`Already approved:         ${alreadyApprovedPhotos}`);
  console.log(`Step remapped (ph_bl/drop): ${remappedPhotos}`);
  console.log(`Auto-approved (>=${CONFIDENCE_THRESHOLD}): ${autoApprovedPhotos}`);
  console.log(`Low confidence (skipped):  ${lowConfidencePhotos}`);
  console.log(`DRs updated:              ${drsUpdated}`);
  console.log(`DRs now fully approved:   ${newlyFullyApproved}`);
  console.log('');

  if (!apply) {
    console.log('This was a DRY RUN. Run with --apply to write changes.');
  } else {
    console.log('Changes applied to database.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
