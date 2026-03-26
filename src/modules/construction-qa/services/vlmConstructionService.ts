/**
 * VLM Construction Service
 *
 * AI-powered photo validation for construction QA using Qwen3-VL on Velocity:8100.
 * Evaluates photos per checklist step and returns structured results.
 *
 * Pattern: OpenAI-compatible chat/completions API with image_url messages.
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { getChecklist } from '../types/construction.types';
import type { Discipline, VlmStepResult, VlmOverallResult } from '../types';
import { recordCorrectExtraction, getVlmFewShotExamples, buildVlmFewShotPrompt } from '@/services/vlmLearningService';

const sql = neon(process.env.DATABASE_URL!);
const MODULE = 'cqa-vlm';
const VLM_URL = process.env.VLM_SERVICE_URL || 'http://100.96.203.105:8100';
const VLM_MODEL = 'Qwen/Qwen3-VL-8B-Instruct';
const MAX_IMAGE_DIM = 1024;

interface ValidateOptions {
  reviewId: string;
  discipline: Discipline;
  photoId?: string;
  forceRerun?: boolean;
}

interface ValidateResult {
  photosProcessed: number;
  overallConfidence: number | null;
  vlmStatus: string;
  stepResults: VlmStepResult[];
  error?: string;
}

/**
 * Run VLM validation on a review's photos.
 * Updates construction_qa_reviews and construction_qa_photos with results.
 */
export async function validateReviewPhotos(opts: ValidateOptions): Promise<ValidateResult> {
  const { reviewId, discipline, photoId, forceRerun = false } = opts;
  const result: ValidateResult = {
    photosProcessed: 0,
    overallConfidence: null,
    vlmStatus: 'processing',
    stepResults: [],
  };

  try {
    // Mark review as processing
    await sql`
      UPDATE construction_qa_reviews
      SET vlm_status = 'processing', updated_at = NOW()
      WHERE id = ${reviewId}::uuid
    `;

    // Log activity
    await sql`
      INSERT INTO construction_qa_activity (review_id, event_type, actor, payload)
      VALUES (${reviewId}::uuid, 'vlm_started', 'vlm', '{}'::jsonb)
    `;

    // Fetch photos to validate
    let photosQuery = `
      SELECT id, storage_key, source, checklist_step, step_label, filename
      FROM construction_qa_photos
      WHERE review_id = $1::uuid
    `;
    const params: (string | boolean)[] = [reviewId];

    if (photoId) {
      photosQuery += ` AND id = $2::uuid`;
      params.push(photoId);
    } else if (!forceRerun) {
      photosQuery += ` AND vlm_processed_at IS NULL`;
    }

    photosQuery += ` ORDER BY checklist_step ASC NULLS LAST`;

    const photos = await sql.query(photosQuery, params);

    if (photos.length === 0) {
      result.vlmStatus = 'completed';
      await sql`
        UPDATE construction_qa_reviews
        SET vlm_status = 'completed', updated_at = NOW()
        WHERE id = ${reviewId}::uuid
      `;
      return result;
    }

    const checklist = getChecklist(discipline);

    // Fetch few-shot correction examples for prompt enhancement (non-blocking on failure)
    let fewShotSection = '';
    try {
      const fewShotExamples = await getVlmFewShotExamples({
        module: 'construction_qa',
        analysisType: 'construction_photo_qa',
        context: { discipline },
        maxExamples: 3,
        prioritizeCanonical: true,
      });
      fewShotSection = buildVlmFewShotPrompt(fewShotExamples, 'markdown');
    } catch (fewShotErr) {
      log.warn('Few-shot retrieval failed, continuing without', {
        error: (fewShotErr as Error).message,
      }, MODULE);
    }

    // Process each photo
    for (const photo of photos) {
      try {
        const step = photo.checklist_step;
        const stepDef = step ? checklist.find(s => s.step === step) : null;

        // Build the prompt for this photo
        const prompt = buildPhotoPrompt(discipline, step, stepDef ?? null, fewShotSection);

        // Build the photo URL for VLM
        const photoUrl = buildPhotoUrl(photo.storage_key, photo.source);

        // Call VLM
        const vlmResult = await callVlm(photoUrl, prompt, step || 0, stepDef?.label || 'Uncategorized');

        // If VLM classified the step (classification mode), update the step assignment
        // Use extracted_data.classified_step if available, otherwise use vlmResult.step
        // (the VLM model doesn't always include classified_step in JSON but parseVlmResponse sets step)
        const classifiedStep = vlmResult.extracted_data?.classified_step ?? vlmResult.step;
        const wasClassified = classifiedStep != null && (!photo.checklist_step || photo.checklist_step === 0);

        // Update photo with results
        await sql`
          UPDATE construction_qa_photos
          SET vlm_valid = ${vlmResult.valid},
              vlm_confidence = ${vlmResult.confidence},
              vlm_issues = ${vlmResult.issues || []}::text[],
              vlm_feedback = ${vlmResult.feedback},
              vlm_raw = ${JSON.stringify(vlmResult)}::jsonb,
              vlm_processed_at = NOW(),
              checklist_step = ${wasClassified ? Number(classifiedStep) : (photo.checklist_step ?? null)},
              step_label = ${wasClassified ? vlmResult.step_label : (photo.step_label ?? null)},
              updated_at = NOW()
          WHERE id = ${photo.id}::uuid
        `;

        result.stepResults.push(vlmResult);
        result.photosProcessed++;

        // Record VLM learning metric (fire-and-forget)
        if (vlmResult.confidence >= 0.7) {
          recordCorrectExtraction('construction_qa', 'construction_photo_qa', vlmResult.confidence)
            .catch(() => {});
        }
      } catch (photoErr) {
        log.error('Photo VLM failed', { photoId: photo.id, error: (photoErr as Error).message }, MODULE);
      }
    }

    // Calculate overall confidence
    if (result.stepResults.length > 0) {
      const totalConf = result.stepResults.reduce((sum, r) => sum + r.confidence, 0);
      result.overallConfidence = Number((totalConf / result.stepResults.length).toFixed(3));
    }

    // Build overall result
    const overallResult: VlmOverallResult = {
      overall_valid: result.stepResults.every(r => r.valid),
      overall_confidence: result.overallConfidence || 0,
      steps: Object.fromEntries(result.stepResults.map(r => [String(r.step), r])),
      cross_step_issues: [],
      processed_at: new Date().toISOString(),
      model_version: VLM_MODEL,
    };

    // Build step scores
    const stepScores: Record<string, number> = {};
    for (const sr of result.stepResults) {
      stepScores[`step_${String(sr.step).padStart(2, '0')}`] = sr.confidence;
    }

    // Recalculate civil step flags from actual photo classifications
    // This ensures step=0 (Unrelated/optical) photos don't count toward civil coverage
    if (discipline === 'civil') {
      await sql`
        WITH photo_steps AS (
          SELECT
            bool_or(checklist_step = 1) AS s1, bool_or(checklist_step = 2) AS s2,
            bool_or(checklist_step = 3) AS s3, bool_or(checklist_step = 4) AS s4,
            bool_or(checklist_step = 5) AS s5, bool_or(checklist_step = 6) AS s6,
            bool_or(checklist_step = 7) AS s7, bool_or(checklist_step = 8) AS s8
          FROM construction_qa_photos
          WHERE review_id = ${reviewId}::uuid
            AND checklist_step IS NOT NULL
            AND checklist_step > 0
        )
        UPDATE construction_qa_reviews SET
          civil_step_01_before_photo = COALESCE(ps.s1, false),
          civil_step_02_during_photo = COALESCE(ps.s2, false),
          civil_step_03_depth_photo = COALESCE(ps.s3, false),
          civil_step_04_end_plates = COALESCE(ps.s4, false),
          civil_step_05_compaction = COALESCE(ps.s5, false),
          civil_step_06_level_check = COALESCE(ps.s6, false),
          civil_step_07_after_photo = COALESCE(ps.s7, false),
          civil_step_08_signature = COALESCE(ps.s8, false)
        FROM photo_steps ps
        WHERE id = ${reviewId}::uuid
      `;
    }

    // Update review with aggregate results
    result.vlmStatus = 'completed';
    await sql`
      UPDATE construction_qa_reviews
      SET vlm_status = 'completed',
          vlm_confidence = ${result.overallConfidence},
          vlm_step_scores = ${JSON.stringify(stepScores)}::jsonb,
          vlm_issues = ${overallResult.cross_step_issues || []}::text[],
          vlm_raw_response = ${JSON.stringify(overallResult)}::jsonb,
          vlm_processed_at = NOW(),
          vlm_model_version = ${VLM_MODEL},
          updated_at = NOW()
      WHERE id = ${reviewId}::uuid
    `;

    // Log completion
    await sql`
      INSERT INTO construction_qa_activity (review_id, event_type, actor, payload)
      VALUES (${reviewId}::uuid, 'vlm_completed', 'vlm',
        ${JSON.stringify({ photos_processed: result.photosProcessed, overall_confidence: result.overallConfidence })}::jsonb)
    `;

    return result;
  } catch (err) {
    result.vlmStatus = 'failed';
    result.error = (err as Error).message;

    // Mark as failed
    await sql`
      UPDATE construction_qa_reviews
      SET vlm_status = 'failed',
          vlm_retry_count = vlm_retry_count + 1,
          updated_at = NOW()
      WHERE id = ${reviewId}::uuid
    `.catch((e) => log.warn('DB operation failed (non-critical)', { error: e instanceof Error ? e.message : 'unknown' }, MODULE));

    await sql`
      INSERT INTO construction_qa_activity (review_id, event_type, actor, payload)
      VALUES (${reviewId}::uuid, 'vlm_failed', 'vlm',
        ${JSON.stringify({ error: result.error })}::jsonb)
    `.catch((e) => log.warn('DB operation failed (non-critical)', { error: e instanceof Error ? e.message : 'unknown' }, MODULE));

    log.error('VLM validation failed', { reviewId, error: result.error }, MODULE);
    return result;
  }
}

/**
 * Call the VLM API with a photo and prompt.
 */
async function callVlm(
  imageUrl: string,
  prompt: string,
  step: number,
  stepLabel: string,
): Promise<VlmStepResult> {
  try {
    const response = await fetch(`${VLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLM_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
              { type: 'text', text: prompt },
            ],
          },
        ],
        max_tokens: 1024,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`VLM HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    // Parse structured JSON from VLM response
    return parseVlmResponse(text, step, stepLabel);
  } catch (err) {
    log.error('VLM call failed', { error: (err as Error).message }, MODULE);

    // Return a failure result
    return {
      valid: false,
      confidence: 0,
      step,
      step_label: stepLabel,
      issues: [`VLM error: ${(err as Error).message}`],
      feedback: 'AI validation unavailable — manual review required',
      extracted_data: {},
    };
  }
}

/**
 * Parse VLM text response into structured result.
 */
function parseVlmResponse(text: string, step: number, stepLabel: string): VlmStepResult {
  try {
    // Try to find JSON in the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // Use VLM's classified_step if provided (classification mode)
      const classifiedStep = parsed.classified_step != null ? Number(parsed.classified_step) : null;
      const finalStep = classifiedStep != null ? classifiedStep : step;
      const finalLabel = classifiedStep != null && parsed.step_label ? String(parsed.step_label) : stepLabel;

      return {
        valid: Boolean(parsed.valid ?? parsed.pass ?? false),
        confidence: Number(parsed.confidence ?? parsed.score ?? 0) / (parsed.score != null && parsed.score > 1 ? 10 : 1),
        step: finalStep,
        step_label: finalLabel,
        issues: Array.isArray(parsed.issues) ? parsed.issues : parsed.issue ? [parsed.issue] : [],
        feedback: parsed.feedback || parsed.comment || '',
        extracted_data: {
          ...(parsed.extracted_data || parsed.data || {}),
          ...(classifiedStep != null ? { classified_step: classifiedStep } : {}),
        },
      };
    }
  } catch {
    // JSON parse failed — fall through to text analysis
  }

  // Fallback: analyze text for pass/fail indicators
  const lower = text.toLowerCase();
  const valid = lower.includes('pass') || lower.includes('acceptable') || lower.includes('meets');
  const confidence = valid ? 0.7 : 0.3;

  return {
    valid,
    confidence,
    step,
    step_label: stepLabel,
    issues: valid ? [] : ['See VLM feedback for details'],
    feedback: text.slice(0, 500),
    extracted_data: {},
  };
}

/**
 * Build discipline-specific VLM prompt for a checklist step.
 */
function buildPhotoPrompt(
  discipline: Discipline,
  step: number | null,
  stepDef: { label: string; vlmCheck: string; notes?: string } | null,
  fewShotSection = '',
): string {
  // When step is null or 0, use multi-step classification mode
  const isClassification = !step || !stepDef;

  const classificationBlock = isClassification ? `
You must CLASSIFY which checklist step this photo belongs to.

CIVIL CHECKLIST STEPS:
  Step 1 - Before Photo: Undisturbed ground with chalk/spray paint markings (circle, square, or X). NO hole dug yet. Ground surface is INTACT. This is taken BEFORE any digging starts.
  Step 2 - During Photo: Active excavation — an OPEN HOLE is visible in the ground, workers digging, spade/pick visible, freshly dug earth piled beside hole. Ground has been BROKEN OPEN. No pole installed yet.
  Step 3 - Depth Photo: Measuring tape or ruler placed inside hole showing depth measurement
  Step 4 - End Plates: Metal rectangular end-plates or cap plates bolted to the top or base of the pole, close-up
  Step 5 - Compaction / Backfill: Sand+cement mix packed around pole base, compacted surface — NOT loose heaps
  Step 6 - Level Check: Spirit level (bubble level tool) held against the upright pole
  Step 7 - After Photo: Wide shot from distance showing the full pole standing upright in the ground
  Step 0 - Unrelated: Photo does NOT show any civil pole installation activity

⚠️ OPTICAL EQUIPMENT = UNRELATED (Step 0):
The following are OPTICAL/FIBRE equipment — they are NOT civil pole installation steps:
- Splice trays, fibre splice closures, fusion splice cassettes
- Dome joints, dome interiors, dome enclosures
- Fibre optic splitter boxes, ODF panels, patch panels
- Fibre labels, fibre identification tags on cables
- Cable termination boxes, optical network terminals (ONTs)
- Loose tube fibre, fibre strands, fibre pigtails
- Any close-up of fibre optic cables, connectors, or equipment
If you see ANY of the above, classify as Step 0 (Unrelated) immediately.

⚠️ CRITICAL: BEFORE vs DURING — these are the most commonly confused steps:
  Step 1 (Before): Ground is FLAT and UNBROKEN. You see paint/chalk marks on intact soil. NO hole.
  Step 2 (During): Ground is BROKEN. You see a DUG HOLE, piled dirt, or active digging. NO pole yet.
  → If ground is intact with markings → Step 1
  → If ground is broken with a hole → Step 2
  → If unsure, look for a HOLE: hole present = Step 2, no hole = Step 1

⚠️ CLASSIFICATION TIPS:
- If you see metal plates/caps on a pole → Step 4 (End Plates), NOT Step 2
- If you see packed/compacted ground around pole base → Step 5 (Compaction), NOT Step 2
- If you see a wide outdoor shot with a pole standing → Step 7 (After Photo), NOT Step 2
- If you see ground markings on INTACT ground → Step 1 (Before Photo), NOT Step 2
- Step 2 (During) ONLY if the ground is broken open with visible hole or active digging
- If you see fibre optic equipment, domes, splice trays → Step 0 (Unrelated), even if a pole is visible
- Do NOT default to "Unrelated" unless the photo truly shows nothing related to pole installation OR shows optical/fibre equipment

Respond with this JSON:
{
  "classified_step": <1-7 or 0 if unrelated/optical>,
  "step_label": "<label from the list above>",
  "valid": true/false,
  "confidence": 0.0-1.0,
  "issues": ["list of specific issues found"],
  "feedback": "one sentence of actionable feedback",
  "extracted_data": {}
}
` : '';

  const validationBlock = !isClassification ? `
Evaluate this photo and respond with ONLY a JSON object:
{
  "valid": true/false,
  "confidence": 0.0-1.0,
  "issues": ["list of specific issues found"],
  "feedback": "one sentence of actionable feedback for the field technician",
  "extracted_data": { any relevant data extracted from the photo }
}

Be strict but fair. A photo must clearly show the required element to pass.` : '';

  const base = `You are a construction quality assurance AI inspector for fiber network installations.
Discipline: ${discipline}
${!isClassification ? `Checklist Step ${step}: ${stepDef?.label || 'Unknown'}` : 'Photo Step Classification'}

${stepDef?.vlmCheck ? `Check: ${stepDef.vlmCheck}` : ''}
${stepDef?.notes ? `Notes: ${stepDef.notes}` : ''}
${fewShotSection ? `\n${fewShotSection}\n` : ''}${classificationBlock}${validationBlock}`;

  return base;
}


/**
 * Build a URL for the VLM to access the photo.
 */
function buildPhotoUrl(storageKey: string, source: string): string {
  // VLM runs on Velocity, so we use the local API to proxy the photo
  const port = process.env.PORT || '3000';
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${port}`;
  return `${baseUrl}/api/construction-qa/photo-proxy?key=${encodeURIComponent(storageKey)}&source=${source}&vlm=true`;
}
