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
      SELECT id, storage_key, source, checklist_step, filename
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

        // Update photo with results
        await sql`
          UPDATE construction_qa_photos
          SET vlm_valid = ${vlmResult.valid},
              vlm_confidence = ${vlmResult.confidence},
              vlm_issues = ${vlmResult.issues || []}::text[],
              vlm_feedback = ${vlmResult.feedback},
              vlm_raw = ${JSON.stringify(vlmResult)}::jsonb,
              vlm_processed_at = NOW(),
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
      return {
        valid: Boolean(parsed.valid ?? parsed.pass ?? false),
        confidence: Number(parsed.confidence ?? parsed.score ?? 0) / (parsed.score != null && parsed.score > 1 ? 10 : 1),
        step,
        step_label: stepLabel,
        issues: Array.isArray(parsed.issues) ? parsed.issues : parsed.issue ? [parsed.issue] : [],
        feedback: parsed.feedback || parsed.comment || '',
        extracted_data: parsed.extracted_data || parsed.data || {},
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
  Step 1 - Before Photo: Ground markings visible (circle/square/X painted on ground indicating pole hole location)
  Step 2 - During Photo: Workers actively digging a hole or pouring concrete — action in progress
  Step 3 - Depth Photo: Measuring tape or ruler placed inside hole showing depth measurement
  Step 4 - End Plates: Metal rectangular end-plates or cap plates bolted to the top or base of the pole, close-up
  Step 5 - Compaction / Backfill: Sand+cement mix packed around pole base, compacted surface — NOT loose heaps
  Step 6 - Level Check: Spirit level (bubble level tool) held against the upright pole
  Step 7 - After Photo: Wide shot from distance showing the full pole standing upright in the ground

⚠️ CLASSIFICATION TIPS:
- If you see metal plates/caps on a pole → Step 4 (End Plates), NOT Step 2
- If you see packed/compacted ground around pole base → Step 5 (Compaction), NOT Step 2
- If you see a wide outdoor shot with a pole standing → Step 7 (After Photo), NOT Step 2
- If you see ground markings before any digging → Step 1 (Before Photo)
- Step 2 (During) ONLY if workers are actively digging or there is an open hole being dug
- Do NOT default to "Unrelated" unless the photo truly shows nothing related to pole installation

Respond with this JSON:
{
  "classified_step": <1-7 or 0 if truly unrelated>,
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
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3004';
  return `${baseUrl}/api/construction-qa/photo-proxy?key=${encodeURIComponent(storageKey)}&source=${source}`;
}
