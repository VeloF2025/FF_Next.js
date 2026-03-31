/**
 * POST /api/qfield/qa-validate
 * Trigger VLM validation for one or more photos
 *
 * Calls the VLM service on Velocity to validate QField photos
 * against FiberTime standards and stores results.
 *
 * For bulk validation (>5 photos), processing runs in the background
 * and returns immediately with a queued status.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { execSync } from 'child_process';
import { recordCorrectExtraction } from '@/services/vlmLearningService';

const sql = neon(process.env.DATABASE_URL!);

// VLM service configuration - use OpenAI-compatible endpoint
const VLM_API_BASE = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_API_ENDPOINT = `${VLM_API_BASE}/v1/chat/completions`;
const VLM_MODEL = 'Qwen/Qwen3-VL-8B-Instruct';
const VLM_TIMEOUT_MS = 60000; // 60 seconds
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'qfieldcloud-prod';

// Batch processing settings
const BATCH_THRESHOLD = 5; // Process in background if more than this many
const CONCURRENT_VALIDATIONS = 3; // Process this many photos at once

// Work type prompts for VLM validation
const VALIDATION_PROMPTS: Record<string, string> = {
  pole_installation: `Validate this fiber pole installation photo.
Required: 1) Full pole visible from base to top, 2) Pole foundation visible, 3) Pole number label readable, 4) Slack bracket if breakout location
FiberTime checks: CCA H4 SANS 754 standard, stays/struts if required, vertical orientation, no damage
Respond with JSON only: {"valid": true/false, "confidence": 0.0-1.0, "issues": [], "feedback": ""}`,

  cable_stringing: `Validate this fiber cable stringing photo.
Required: 1) Cable route visible, 2) Attachment points shown, 3) Slack coil at pole
FiberTime checks: Slack coiled ≤300mm diameter, cable tied to slack bracket, no back-feeding
Respond with JSON only: {"valid": true/false, "confidence": 0.0-1.0, "issues": [], "feedback": ""}`,

  dome_joint: `Validate this dome joint/splice closure photo.
Required: 1) Dome enclosure visible, 2) Slack brackets visible, 3) Emergency mounting points
FiberTime checks: Slack on bracket, backhaul fiber separate, cables labeled
Respond with JSON only: {"valid": true/false, "confidence": 0.0-1.0, "issues": [], "feedback": ""}`,

  activation: `Validate this drop cable installation photo.
Required: 1) Drop cable from STS to house, 2) Connection point visible, 3) Drip loop before entry
FiberTime checks: Max 50m drop, dead-end wrap on pigtail screw, 2-4mm fiber drop cable, slack max 10m
Respond with JSON only: {"valid": true/false, "confidence": 0.0-1.0, "issues": [], "feedback": ""}`,
};

interface ValidationRequest {
  validationIds?: string[];
  photoKeys?: string[];
  workType?: string;
}

interface VLMResponse {
  valid: boolean;
  confidence: number;
  issues: string[];
  feedback: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['POST']);
  }

  try {
    const { validationIds, photoKeys, workType } = req.body as ValidationRequest;

    log.info({
      module: 'qfield-qa-validate',
      validationIdCount: validationIds?.length || 0,
      photoKeyCount: photoKeys?.length || 0,
      workType
    }, 'Validation request received');

    if (!validationIds?.length && !photoKeys?.length) {
      return apiResponse.badRequest(res, 'Either validationIds or photoKeys required');
    }

    const results: Array<{
      id: string;
      photo_key: string;
      success: boolean;
      confidence?: number;
      feedback?: string;
      error?: string;
    }> = [];

    // Get validations to process
    let validations: Array<{ id: string; photo_key: string; work_type: string; project_id: string }> = [];
    if (validationIds?.length) {
      const rows = await sql`
        SELECT id, photo_key, work_type, project_id
        FROM qfield_photo_validations
        WHERE id = ANY(${validationIds}::uuid[])
      `;
      validations = rows as typeof validations;
    } else if (photoKeys?.length) {
      // Create new validation records for photo keys
      for (const key of photoKeys) {
        const existing = await sql`
          SELECT id, photo_key, work_type, project_id
          FROM qfield_photo_validations
          WHERE photo_key = ${key}
          LIMIT 1
        `;
        if (existing.length > 0) {
          validations.push(existing[0] as typeof validations[0]);
        } else {
          // Create new record
          const created = await sql`
            INSERT INTO qfield_photo_validations (
              photo_key,
              work_type,
              workflow_status
            ) VALUES (
              ${key},
              ${workType || 'pole_installation'},
              'pending'
            )
            RETURNING id, photo_key, work_type, project_id
          `;
          validations.push(created[0] as typeof validations[0]);
        }
      }
    }

    // For bulk validation, process in background and return immediately
    if (validations.length > BATCH_THRESHOLD) {
      log.info({ module: 'qfield-qa-validate', count: validations.length }, 'Starting background validation');

      // Mark all as "validating" in DB
      const ids = validations.map(v => v.id);
      await sql`
        UPDATE qfield_photo_validations
        SET workflow_status = 'validating'
        WHERE id = ANY(${ids}::uuid[])
      `;

      // Process in background (fire-and-forget)
      processValidationsInBackground(validations, workType).catch(err => {
        log.error({ module: 'qfield-qa-validate', error: err instanceof Error ? err.message : String(err) }, 'Background validation failed');
      });

      return apiResponse.success(res, {
        total: validations.length,
        queued: validations.length,
        mode: 'background',
        message: 'Validation started in background. Refresh to see results.',
      }, `Queued ${validations.length} photos for validation`);
    }

    // For small batches, process synchronously with concurrency
    const processedResults = await processValidationsConcurrently(validations, workType, CONCURRENT_VALIDATIONS);

    const successCount = processedResults.filter(r => r.success).length;
    const failCount = processedResults.length - successCount;

    return apiResponse.success(res, {
      total: processedResults.length,
      success: successCount,
      failed: failCount,
      results: processedResults,
    }, `Validated ${successCount}/${processedResults.length} photos`);
  } catch (error) {
    log.error({ module: 'qfield-qa-validate', ...(error instanceof Error ? { message: error.message } : { error }) }, 'Handler error');
    return apiResponse.internalError(res, error);
  }
}

/**
 * Fetch photo from MinIO via mc cat (inside Docker container)
 * Returns base64 encoded image data
 */
async function fetchPhotoAsBase64(photoKey: string): Promise<string> {
  const objectPath = photoKey.startsWith('/') ? photoKey.slice(1) : photoKey;

  // Validate path to prevent shell injection
  if (/[;`$|&\\(){}\[\]!#]/.test(objectPath)) {
    throw new Error('Invalid characters in photo key');
  }

  try {
    // Use mc cat inside the MinIO Docker container to fetch the photo
    // The 'local' alias is pre-configured in the container
    const escapedPath = `local/${MINIO_BUCKET}/${objectPath}`.replace(/'/g, "'\\''");
    const command = `docker exec qfieldcloud-minio-1 mc cat '${escapedPath}' 2>/dev/null | base64 -w 0`;

    log.info({ module: 'qfield-qa-validate', photoKey: photoKey.substring(0, 80) }, 'Fetching photo via Docker mc');

    const base64Data = execSync(command, {
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
      encoding: 'utf-8',
      timeout: 30000,
    }).trim();

    if (!base64Data || base64Data.length < 100) {
      log.error({ module: 'qfield-qa-validate', photoKey, dataLen: base64Data?.length || 0 }, 'Empty or invalid image data');
      throw new Error('Empty or invalid image data returned');
    }

    // Check for mc error messages in output
    if (base64Data.startsWith('mc:') || base64Data.includes('ERROR') || base64Data.includes('does not exist')) {
      log.error({ module: 'qfield-qa-validate', photoKey, error: base64Data.substring(0, 200) }, 'mc command returned error');
      throw new Error(`MinIO error: ${base64Data.substring(0, 200)}`);
    }

    log.info({ module: 'qfield-qa-validate', size: Math.round(base64Data.length / 1024) + 'KB' }, 'Photo fetched successfully');
    return base64Data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ module: 'qfield-qa-validate', photoKey: photoKey.substring(0, 80), error: message.substring(0, 200) }, 'Failed to fetch photo');
    throw new Error(`Failed to fetch photo: ${message}`);
  }
}

async function validatePhoto(photoKey: string, workType: string): Promise<VLMResponse> {
  // Fetch the photo as base64
  const base64Image = await fetchPhotoAsBase64(photoKey);

  // Determine mime type from photo key
  const isJpeg = photoKey.toLowerCase().includes('.jpg') || photoKey.toLowerCase().includes('.jpeg');
  const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  // Get the appropriate prompt
  const prompt = VALIDATION_PROMPTS[workType] || VALIDATION_PROMPTS.pole_installation;

  // Call VLM service with OpenAI-compatible format
  const response = await fetch(VLM_API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VLM_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: dataUrl },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(VLM_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`VLM service error: ${response.status} - ${errorText.substring(0, 200)}`);
  }

  const result = await response.json();

  // Parse VLM response from OpenAI-compatible format
  let vlmData: VLMResponse;
  try {
    const responseText = result.choices?.[0]?.message?.content || '';
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      vlmData = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON found in VLM response');
    }
  } catch {
    log.error('QaValidateApi', 'Operation failed', { error });
    // If parsing fails, create a default response
    vlmData = {
      valid: false,
      confidence: 0.5,
      issues: ['Unable to parse VLM response'],
      feedback: 'Photo validation could not be completed automatically. Please review manually.',
    };
  }

  // Normalize confidence to 0-1 range
  if (vlmData.confidence > 1) {
    vlmData.confidence = vlmData.confidence / 100;
  }

  return vlmData;
}

/**
 * Process a single validation and update DB
 */
async function processOneValidation(
  validation: { id: string; photo_key: string; work_type: string; project_id: string },
  workType?: string
): Promise<{
  id: string;
  photo_key: string;
  success: boolean;
  confidence?: number;
  feedback?: string;
  error?: string;
}> {
  const effectiveWorkType = validation.work_type || workType || 'pole_installation';
  log.info({
    module: 'qfield-qa-validate',
    id: validation.id,
    photoKey: validation.photo_key?.substring(0, 60),
    workType: effectiveWorkType
  }, 'Processing single validation');

  try {
    const vlmResult = await validatePhoto(
      validation.photo_key,
      effectiveWorkType
    );

    // Update validation record
    const needsRetake = !vlmResult.valid || vlmResult.confidence < 0.6;
    await sql`
      UPDATE qfield_photo_validations
      SET
        vlm_confidence = ${vlmResult.confidence},
        vlm_feedback = ${vlmResult.feedback},
        vlm_raw_response = ${JSON.stringify(vlmResult)}::jsonb,
        needs_retake = ${needsRetake},
        validated_at = NOW(),
        workflow_status = 'pending'
      WHERE id = ${validation.id}::uuid
    `;

    log.debug({
      module: 'qfield-qa-validate',
      id: validation.id,
      confidence: vlmResult.confidence,
      needsRetake,
    }, 'Validation completed');

    // Record VLM learning metric (fire-and-forget, but log failures)
    if (vlmResult.confidence >= 0.7) {
      recordCorrectExtraction('qfield', 'qfield_photo_qa', vlmResult.confidence).catch((err) => {
        log.warn('Failed to record VLM learning metric', { error: err, module: 'qfield-qa-validate', photoId: validation.id });
      });
    }

    return {
      id: validation.id,
      photo_key: validation.photo_key,
      success: true,
      confidence: vlmResult.confidence,
      feedback: vlmResult.feedback,
    };
  } catch (error) {
    log.error('qfield-qa-validate', { error: error instanceof Error ? error.message : String(error) });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Update record with error
    await sql`
      UPDATE qfield_photo_validations
      SET
        workflow_status = 'pending',
        vlm_feedback = ${'Validation error: ' + errorMessage}
      WHERE id = ${validation.id}::uuid
    `.catch((e) => log.warn('DB operation failed (non-critical)', { error: e instanceof Error ? e.message : 'unknown' }, 'qfield')); // Non-critical DB update

    log.error({ module: 'qfield-qa-validate', id: validation.id, error: errorMessage }, 'Validation failed');

    return {
      id: validation.id,
      photo_key: validation.photo_key,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Process validations with concurrency limit (for small batches)
 */
async function processValidationsConcurrently(
  validations: Array<{ id: string; photo_key: string; work_type: string; project_id: string }>,
  workType?: string,
  concurrency = 3
): Promise<Array<{
  id: string;
  photo_key: string;
  success: boolean;
  confidence?: number;
  feedback?: string;
  error?: string;
}>> {
  const results: Array<{
    id: string;
    photo_key: string;
    success: boolean;
    confidence?: number;
    feedback?: string;
    error?: string;
  }> = [];

  // Process in chunks
  for (let i = 0; i < validations.length; i += concurrency) {
    const chunk = validations.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(v => processOneValidation(v, workType))
    );
    results.push(...chunkResults);
  }

  return results;
}

/**
 * Process validations in background (fire-and-forget)
 */
async function processValidationsInBackground(
  validations: Array<{ id: string; photo_key: string; work_type: string; project_id: string }>,
  workType?: string
): Promise<void> {
  const startTime = Date.now();
  let successCount = 0;
  let failCount = 0;

  log.info({ module: 'qfield-qa-validate', total: validations.length }, 'Background validation started');

  // Process with concurrency
  for (let i = 0; i < validations.length; i += CONCURRENT_VALIDATIONS) {
    const chunk = validations.slice(i, i + CONCURRENT_VALIDATIONS);
    const chunkResults = await Promise.all(
      chunk.map(v => processOneValidation(v, workType))
    );

    for (const r of chunkResults) {
      if (r.success) successCount++;
      else failCount++;
    }

    // Log progress every 10 photos
    if ((i + chunk.length) % 10 === 0 || i + chunk.length === validations.length) {
      log.info({
        module: 'qfield-qa-validate',
        processed: i + chunk.length,
        total: validations.length,
        success: successCount,
        failed: failCount,
      }, 'Background validation progress');
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  log.info({
    module: 'qfield-qa-validate',
    total: validations.length,
    success: successCount,
    failed: failCount,
    durationSeconds: duration,
  }, 'Background validation completed');
}

export default withAuth(handler);
