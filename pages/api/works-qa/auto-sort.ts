/**
 * POST /api/works-qa/auto-sort
 *
 * AI auto-sorts photos sitting in a pole's unassigned bucket. Sequential
 * VLM call per photo (single GPU). Three confidence tiers:
 *   ≥0.95 + slot empty  → auto-place into slot, log correction
 *   ≥0.95 + slot filled → suggest (UI shows "→ slot · 99%" + Accept)
 *   0.6 – <0.95         → suggest
 *   <0.6                → leftover (no-op)
 *
 * Body: { pole_id: string }
 * Returns: { auto_placed, suggested, leftover, results[] }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { SLOT_META, getSlotMeta } from '@/modules/works-qa/utils/slot-keys';
import { classifyPhotoToSlot } from '@/modules/works-qa/services/worksQaVlmService';

const AUTO_PLACE_THRESHOLD = 0.95;
const SUGGEST_THRESHOLD = 0.6;
const ALLOWED_PHOTO_COLUMNS = new Set(SLOT_META.map(s => s.dbColumn));

// Loopback so the server-to-server VLM URL lands on the local Next.js process;
// photo-proxy's localhost-bypass accepts it without a session cookie.
const LOOPBACK_PORT = process.env.PORT ?? '3000';
const LOOPBACK_BASE = `http://127.0.0.1:${LOOPBACK_PORT}`;

function photoUrl(key: string): string {
  if (key.startsWith('works-qa/')) return `${LOOPBACK_BASE}/storage/${key}`;
  const source = key.startsWith('projects/')   ? 'qfield'
              : key.startsWith('sharepoint:') ? 'sharepoint'
              :                                 'local';
  return `${LOOPBACK_BASE}/api/construction-qa/photo-proxy?key=${encodeURIComponent(key)}&source=${source}&vlm=true`;
}

interface AutoSortBody { pole_id?: string }

interface PoleRow {
  id: string;
  project_id: string;
  pole_label: string;
  unassigned_photo_keys: string[] | null;
  [k: string]: unknown;
}

type ActionTier = 'auto-placed' | 'suggested' | 'leftover';

interface ResultEntry {
  photo_key: string;
  predicted_slot: string | null;
  confidence: number;
  action: ActionTier;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { pole_id } = (req.body ?? {}) as AutoSortBody;
  if (!pole_id) return apiResponse.badRequest(res, 'pole_id is required');

  const userEmail = (req as AuthenticatedNextApiRequest).user?.email ?? 'auto_sort';

  try {
    const poleResult = await pool.query<PoleRow>(
      `SELECT * FROM pole_qa_photos WHERE id = $1::uuid`,
      [pole_id],
    );
    const pole = poleResult.rows[0];
    if (!pole) return apiResponse.notFound(res, 'Pole', pole_id);

    const photos = Array.isArray(pole.unassigned_photo_keys) ? pole.unassigned_photo_keys : [];
    const results: ResultEntry[] = [];
    let auto_placed = 0, suggested = 0, leftover = 0;

    for (const photo_key of photos) {
      const { slot_key, confidence, reasoning } = await classifyPhotoToSlot(photoUrl(photo_key));

      if (!slot_key || confidence < SUGGEST_THRESHOLD) {
        leftover++;
        results.push({ photo_key, predicted_slot: slot_key, confidence, action: 'leftover' });
        continue;
      }

      const meta = getSlotMeta(slot_key);
      if (!meta || !ALLOWED_PHOTO_COLUMNS.has(meta.dbColumn)) {
        leftover++;
        results.push({ photo_key, predicted_slot: slot_key, confidence, action: 'leftover' });
        continue;
      }

      const slotEmpty = pole[meta.dbColumn] == null;
      const canAutoPlace = confidence >= AUTO_PLACE_THRESHOLD && slotEmpty;

      if (canAutoPlace) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `UPDATE pole_qa_photos
             SET ${meta.dbColumn} = $1,
                 unassigned_photo_keys = array_remove(unassigned_photo_keys, $1),
                 updated_at = NOW()
             WHERE id = $2::uuid`,
            [photo_key, pole_id],
          );
          await client.query(
            `INSERT INTO qa_correction_examples
              (workflow_type, photo_filename, vlm_predicted_step, vlm_predicted_category,
               vlm_confidence, vlm_reasoning, correct_step, correct_category,
               correction_reason, corrected_by)
             VALUES ($1, $2, $3, $4, $5, $6, $3, $4, $7, $8)`,
            [
              'works_qa',
              photo_key,
              meta.stepNumber,
              meta.discipline,
              confidence,
              reasoning,
              'auto_sort_placed',
              userEmail,
            ],
          );
          await client.query('COMMIT');
          // Mutate local copy so subsequent photos see the slot as filled.
          pole[meta.dbColumn] = photo_key;
          pole.unassigned_photo_keys = (pole.unassigned_photo_keys ?? []).filter((k: string) => k !== photo_key);
          auto_placed++;
          results.push({ photo_key, predicted_slot: slot_key, confidence, action: 'auto-placed' });
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          log.error('works-qa/auto-sort: auto-place failed', {
            error: err instanceof Error ? err.message : String(err),
            pole_id, photo_key, slot_key,
          });
          leftover++;
          results.push({ photo_key, predicted_slot: slot_key, confidence, action: 'leftover' });
        } finally {
          client.release();
        }
        continue;
      }

      // Suggestion tier (≥0.6 but either <0.95 or slot already filled). Per-photo
      // try/catch so a single UPDATE failure doesn't lose the auto-placed photos
      // already committed in previous loop iterations — fall back to leftover.
      try {
        await pool.query(
          `UPDATE pole_qa_photos
           SET unassigned_suggestions = unassigned_suggestions ||
               jsonb_build_object($1::text, jsonb_build_object(
                 'suggested_slot', $2::text,
                 'confidence', $3::numeric,
                 'generated_at', NOW()
               )),
               updated_at = NOW()
           WHERE id = $4::uuid`,
          [photo_key, slot_key, confidence, pole_id],
        );
        suggested++;
        results.push({ photo_key, predicted_slot: slot_key, confidence, action: 'suggested' });
      } catch (err) {
        log.error('works-qa/auto-sort: suggestion write failed', {
          error: err instanceof Error ? err.message : String(err),
          pole_id, photo_key, slot_key,
        });
        leftover++;
        results.push({ photo_key, predicted_slot: slot_key, confidence, action: 'leftover' });
      }
    }

    return apiResponse.success(res, { auto_placed, suggested, leftover, results });
  } catch (err) {
    log.error('works-qa/auto-sort', { error: err instanceof Error ? err.message : String(err), pole_id });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa.auto-sort', 'create')(handler));
