/**
 * VLM QA Validation Service
 *
 * Purpose: Phase 2 of 3-Phase QA Workflow - AI quality validation against
 * FiberTime Installation Standards Rev 1.1
 *
 * Phase 1: Attribute-based categorization (instant, deterministic) → stepMapper.ts
 * Phase 2: VLM Quality Validation (AI checks against FiberTime spec) → THIS FILE
 * Phase 3: Human Review (card grid with approve/reject) → UI components
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { log, createLogger } from '@/lib/logger';
import { STEP_LABELS } from '../utils/stepMapper';

// Component logger
const logger = createLogger('VlmQaValidation');

// ============================================================================
// CONFIGURATION
// ============================================================================

const VLM_API_BASE = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_API_ENDPOINT = `${VLM_API_BASE}/v1/chat/completions`;
const VLM_MODEL = process.env.VLM_QA_MODEL || process.env.VLM_MODEL || 'QuantTrio/Qwen3-VL-32B-Instruct-AWQ';
const VLM_TIMEOUT_MS = 120000; // 2 minutes per photo
const VLM_TEMPERATURE = 0.1; // Low for consistent QA results

// ============================================================================
// TYPES
// ============================================================================

/**
 * QA validation status
 */
export type QaValidationStatus = 'pending' | 'processing' | 'validated' | 'failed';

/**
 * Individual QA check result
 */
export interface QaCheckResult {
  /** Check identifier */
  checkId: string;

  /** Check description */
  description: string;

  /** Did this check pass? */
  passed: boolean;

  /** Severity: critical, major, minor */
  severity: 'critical' | 'major' | 'minor';

  /** Details or reason for failure */
  details: string;
}

/**
 * Step QA validation result
 */
export interface StepQaResult {
  /** Step number (1-10) */
  step: number;

  /** Step label */
  stepLabel: string;

  /** Photo filename */
  filename: string;

  /** Overall pass/fail for this step */
  passed: boolean;

  /** QA score (0-100) */
  score: number;

  /** Individual check results */
  checks: QaCheckResult[];

  /** VLM observations about the photo */
  observations: string;

  /** Suggested feedback for technician */
  feedback: string;

  /** Processing time in ms */
  processingTimeMs: number;

  /** Error message if failed */
  error?: string;
}

/**
 * Batch QA validation result
 */
export interface BatchQaResult {
  /** DR number */
  drNumber: string;

  /** Overall status */
  status: QaValidationStatus;

  /** Total photos validated */
  totalPhotos: number;

  /** Photos that passed QA */
  passedCount: number;

  /** Photos that failed QA */
  failedCount: number;

  /** Overall pass rate (0-100) */
  passRate: number;

  /** Individual step results */
  stepResults: StepQaResult[];

  /** Summary of critical issues */
  criticalIssues: string[];

  /** Processing time in ms */
  totalProcessingTimeMs: number;

  /** Error if batch failed */
  error?: string;
}

/**
 * Photo input for QA validation
 */
export interface QaPhotoInput {
  /** Photo filename */
  filename: string;

  /** Photo URL */
  url: string;

  /** Step number (from Phase 1 categorization) */
  step: number;
}

// ============================================================================
// FIBERTIME INSTALLATION STANDARDS - QA CHECKLIST
// ============================================================================

/**
 * Step-specific QA criteria based on FiberTime Installation Standards Rev 1.1
 */
const STEP_QA_CRITERIA: Record<number, { checks: Array<{ id: string; description: string; severity: 'critical' | 'major' | 'minor' }> }> = {
  1: {
    // House Photo
    checks: [
      { id: '1.1', description: 'House/property clearly visible', severity: 'critical' },
      { id: '1.2', description: 'Address or identifying features visible', severity: 'major' },
      { id: '1.3', description: 'Photo is in focus and well-lit', severity: 'minor' },
    ],
  },
  2: {
    // Cable from Pole
    checks: [
      { id: '2.1', description: 'Aerial cable clearly visible from pole to house', severity: 'critical' },
      { id: '2.2', description: 'Cable has proper tension (not sagging excessively)', severity: 'major' },
      { id: '2.3', description: 'No visible damage or kinks in cable', severity: 'major' },
    ],
  },
  3: {
    // Entry Outside - FiberTime spec additions
    checks: [
      { id: '3.1', description: 'Entry point clearly visible on exterior wall', severity: 'critical' },
      { id: '3.2', description: 'Pigtail screw properly sealed with silicone or Laykold tape', severity: 'critical' },
      { id: '3.3', description: 'Drip loop present before entry point', severity: 'major' },
      { id: '3.4', description: 'Weatherproofing appears adequate', severity: 'major' },
    ],
  },
  4: {
    // Entry Inside
    checks: [
      { id: '4.1', description: 'Cable entry point visible from inside', severity: 'critical' },
      { id: '4.2', description: 'Entry point properly sealed/finished', severity: 'major' },
      { id: '4.3', description: 'Cable routing is neat and professional', severity: 'minor' },
    ],
  },
  5: {
    // Wall - FiberTime spec additions
    checks: [
      { id: '5.1', description: 'Mounting surface visible and suitable', severity: 'critical' },
      { id: '5.2', description: 'Varnished wooden board present (280x120mm)', severity: 'critical' },
      { id: '5.3', description: 'Board appears level', severity: 'major' },
      { id: '5.4', description: 'Power outlet accessible nearby', severity: 'major' },
    ],
  },
  6: {
    // ONT Back After Install
    checks: [
      { id: '6.1', description: 'ONT back panel clearly visible', severity: 'critical' },
      { id: '6.2', description: 'Fiber cable properly connected', severity: 'critical' },
      { id: '6.3', description: 'Power cable connected', severity: 'critical' },
      { id: '6.4', description: 'Cables neatly managed (no excessive slack)', severity: 'minor' },
    ],
  },
  7: {
    // Power Meter Reading - FiberTime spec additions
    checks: [
      { id: '7.1', description: 'Power meter display clearly readable', severity: 'critical' },
      { id: '7.2', description: 'dBm reading visible (valid range: -18 to -24 dBm)', severity: 'critical' },
      { id: '7.3', description: 'Reading within acceptable range', severity: 'critical' },
    ],
  },
  8: {
    // Final Installation - FiberTime spec additions
    checks: [
      { id: '8.1', description: 'Complete setup visible (ONT, UPS/Gizzu, cables)', severity: 'critical' },
      { id: '8.2', description: 'Gizzu/UPS properly cable-tied', severity: 'major' },
      { id: '8.3', description: 'Gizzu set to 12V selector (if visible)', severity: 'critical' },
      { id: '8.4', description: 'Slack loop present and ≤300mm', severity: 'major' },
      { id: '8.5', description: 'Antennas positioned upright (if applicable)', severity: 'minor' },
      { id: '8.6', description: 'Overall installation neat and professional', severity: 'minor' },
    ],
  },
  9: {
    // Green Lights on ONT - FiberTime spec additions
    checks: [
      { id: '9.1', description: 'ONT front panel clearly visible', severity: 'critical' },
      { id: '9.2', description: 'Green status lights illuminated', severity: 'critical' },
      { id: '9.3', description: 'FT sticker present and centered', severity: 'major' },
      { id: '9.4', description: 'Lights NOT covered by sticker', severity: 'critical' },
      { id: '9.5', description: 'Drop label present (black on yellow)', severity: 'major' },
    ],
  },
  10: {
    // Signature
    checks: [
      { id: '10.1', description: 'Signature document visible', severity: 'critical' },
      { id: '10.2', description: 'Signature present on document', severity: 'critical' },
      { id: '10.3', description: 'Document legible', severity: 'major' },
    ],
  },
};

// ============================================================================
// PROMPTS
// ============================================================================

/**
 * Build QA validation prompt for a specific step
 */
function buildQaPrompt(step: number, drNumber: string): string {
  const stepLabel = STEP_LABELS[step] || `Step ${step}`;
  const criteria = STEP_QA_CRITERIA[step];

  if (!criteria) {
    return `Analyze this installation photo for ${drNumber} (${stepLabel}) and assess its quality.`;
  }

  const checksText = criteria.checks
    .map((c) => `- [${c.id}] ${c.description} (${c.severity})`)
    .join('\n');

  return `You are a fiber optic installation QA inspector reviewing a photo for ${drNumber}.

This photo is expected to be a "${stepLabel}" photo (Step ${step}).

FIRST: Verify this photo actually matches Step ${step} (${stepLabel}). If the photo clearly shows something different, note the mismatch in your observations and evaluate based on what the photo ACTUALLY shows.

QUALITY CHECKLIST - Evaluate each item:
${checksText}

For this photo, respond in this exact JSON format:
{
  "passed": <true/false - overall pass if all critical checks pass>,
  "score": <0-100 quality score>,
  "stepMismatch": <true/false - true if photo does not match the expected step>,
  "actualStep": <number or null - if stepMismatch is true, what step this photo actually belongs to>,
  "checks": [
    {
      "checkId": "<check ID from list>",
      "passed": <true/false>,
      "details": "<specific observation or reason for failure>"
    }
  ],
  "observations": "<what you observe in this photo>",
  "feedback": "<constructive feedback for technician if issues found, or 'Good quality photo' if passed>"
}

Be strict but fair. Critical issues must fail the photo. Minor issues should be noted but may still pass.
Focus on what is VISIBLE in the photo - don't fail for items that simply aren't shown.
If the photo is misclassified (wrong step), it must FAIL regardless of quality.`;
}

// ============================================================================
// IMAGE HANDLING
// ============================================================================

/**
 * Fetch an image and convert to base64
 */
async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  try {
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer.toString('base64');
  } catch (error) {
    logger.error(`Failed to fetch/encode image ${imageUrl}: ${error}`);
    throw error;
  }
}

// ============================================================================
// VLM API CALLS
// ============================================================================

/**
 * Call VLM API to validate a single photo
 */
async function callVlmForQa(
  drNumber: string,
  step: number,
  base64Image: string
): Promise<{
  passed: boolean;
  score: number;
  checks: Array<{ checkId: string; passed: boolean; details: string }>;
  observations: string;
  feedback: string;
  stepMismatch?: boolean;
  actualStep?: number | null;
}> {
  const prompt = buildQaPrompt(step, drNumber);

  const requestBody = {
    model: VLM_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64Image}` },
          },
        ],
      },
    ],
    max_tokens: 2000,
    temperature: VLM_TEMPERATURE,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);

  try {
    const response = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`VLM API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in VLM response');
    }

    // Extract JSON from response
    const jsonMatch =
      content.match(/```json\n([\s\S]*?)\n```/) ||
      content.match(/```\n([\s\S]*?)\n```/) ||
      [null, content];

    const parsed = JSON.parse(jsonMatch[1] || content);

    const stepMismatch = Boolean(parsed.stepMismatch);

    return {
      passed: stepMismatch ? false : Boolean(parsed.passed),
      score: stepMismatch ? 0 : (Number(parsed.score) || 0),
      checks: parsed.checks || [],
      observations: parsed.observations || '',
      feedback: stepMismatch
        ? `Step mismatch: photo appears to be Step ${parsed.actualStep}, not the expected step. ${parsed.feedback || ''}`
        : (parsed.feedback || ''),
      stepMismatch,
      actualStep: parsed.actualStep ?? null,
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('VLM API request timed out');
    }

    throw error;
  }
}

// ============================================================================
// MAIN VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate a single photo against QA criteria
 *
 * @param drNumber - DR number being processed
 * @param photo - Photo with URL and step from Phase 1
 * @returns Step QA result
 */
export async function validatePhoto(
  drNumber: string,
  photo: QaPhotoInput
): Promise<StepQaResult> {
  const startTime = Date.now();
  const stepLabel = STEP_LABELS[photo.step] || `Step ${photo.step}`;
  const criteria = STEP_QA_CRITERIA[photo.step];

  logger.info(`Validating ${photo.filename} for ${drNumber} (${stepLabel})`);

  try {
    // Fetch and encode image
    const base64 = await fetchImageAsBase64(photo.url);

    // Call VLM for QA
    const vlmResult = await callVlmForQa(drNumber, photo.step, base64);

    // Map VLM checks to our format
    const checks: QaCheckResult[] = (criteria?.checks || []).map((criteriaCheck) => {
      const vlmCheck = vlmResult.checks.find((c) => c.checkId === criteriaCheck.id);
      return {
        checkId: criteriaCheck.id,
        description: criteriaCheck.description,
        passed: vlmCheck?.passed ?? (criteriaCheck.severity === 'critical' ? false : true), // Critical checks default to failed if not evaluated
        severity: criteriaCheck.severity,
        details: vlmCheck?.details || 'Not evaluated',
      };
    });

    return {
      step: photo.step,
      stepLabel,
      filename: photo.filename,
      passed: vlmResult.passed,
      score: vlmResult.score,
      checks,
      observations: vlmResult.observations,
      feedback: vlmResult.feedback,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error(`Failed to validate ${photo.filename}: ${error}`);

    return {
      step: photo.step,
      stepLabel,
      filename: photo.filename,
      passed: false,
      score: 0,
      checks: [],
      observations: '',
      feedback: '',
      processingTimeMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Validate multiple photos (batch operation)
 *
 * Runs QA validation on all categorized photos for a DR.
 *
 * @param drNumber - DR number being processed
 * @param photos - Array of photos with URLs and steps from Phase 1
 * @returns Batch QA result with statistics
 */
export async function validateBatch(
  drNumber: string,
  photos: QaPhotoInput[]
): Promise<BatchQaResult> {
  const startTime = Date.now();

  logger.info(`Starting batch QA for ${drNumber}: ${photos.length} photos`);

  const stepResults: StepQaResult[] = [];
  const criticalIssues: string[] = [];

  // Process photos sequentially (VLM can be resource-intensive)
  for (const photo of photos) {
    const result = await validatePhoto(drNumber, photo);
    stepResults.push(result);

    // Collect critical failures
    for (const check of result.checks) {
      if (!check.passed && check.severity === 'critical') {
        criticalIssues.push(`${result.stepLabel}: ${check.description}`);
      }
    }
  }

  const passedCount = stepResults.filter((r) => r.passed).length;
  const failedCount = stepResults.filter((r) => !r.passed).length;
  const passRate = photos.length > 0 ? Math.round((passedCount / photos.length) * 100) : 0;

  const totalProcessingTimeMs = Date.now() - startTime;

  logger.info(
    `Batch QA complete for ${drNumber}: ${passedCount}/${photos.length} passed (${passRate}%) in ${totalProcessingTimeMs}ms`
  );

  return {
    drNumber,
    status: 'validated',
    totalPhotos: photos.length,
    passedCount,
    failedCount,
    passRate,
    stepResults,
    criticalIssues,
    totalProcessingTimeMs,
  };
}

/**
 * Get QA criteria for a specific step
 */
export function getStepCriteria(step: number) {
  return STEP_QA_CRITERIA[step] || null;
}

/**
 * Get all QA criteria
 */
export function getAllCriteria() {
  return STEP_QA_CRITERIA;
}

/**
 * Generate summary feedback from batch results
 */
export function generateBatchFeedback(result: BatchQaResult): string {
  if (result.passRate === 100) {
    return `✅ All ${result.totalPhotos} photos passed QA. Great work!`;
  }

  const lines: string[] = [];

  if (result.criticalIssues.length > 0) {
    lines.push(`⚠️ ${result.criticalIssues.length} critical issues found:`);
    result.criticalIssues.slice(0, 5).forEach((issue) => {
      lines.push(`  • ${issue}`);
    });
    if (result.criticalIssues.length > 5) {
      lines.push(`  ... and ${result.criticalIssues.length - 5} more`);
    }
  }

  lines.push(`\nQA Summary: ${result.passedCount}/${result.totalPhotos} photos passed (${result.passRate}%)`);

  return lines.join('\n');
}
