/**
 * POST /api/qfield/validate-photo
 * Real-time photo validation for QField plugin
 *
 * Accepts a base64 image directly and returns immediate validation feedback.
 * Optimized for field use with minimal latency.
 *
 * Authentication: API key (X-API-Key header) for plugin use
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { VLM_CHAT_ENDPOINT, VLM_MODEL, VLM_TIMEOUT_REALTIME } from '@/lib/vlm';

// VLM service configuration

// API key for QField plugin — required env var, no fallback
const QFIELD_API_KEY = process.env.QFIELD_PLUGIN_API_KEY;
if (!QFIELD_API_KEY) {
  log.warn('QFIELD_PLUGIN_API_KEY not set — endpoint will reject all requests', { module: 'qfield-validate-photo' });
}

// Work type prompts optimized for field feedback
const VALIDATION_PROMPTS: Record<string, string> = {
  pole_installation: `Analyze this fiber pole installation photo for quality issues.

Check for:
1. Is the full pole visible from base to top?
2. Is the pole foundation/base visible?
3. Is there a pole number label that's readable?
4. Is there a slack bracket (if this is a breakout location)?
5. Is the pole vertical and undamaged?

Respond with JSON only:
{
  "valid": true/false,
  "confidence": 0.0-1.0,
  "issues": ["issue1", "issue2"],
  "feedback": "Brief guidance for technician",
  "suggestRetake": true/false
}`,

  cable_stringing: `Analyze this fiber cable stringing photo for quality issues.

Check for:
1. Is the cable route clearly visible?
2. Are attachment points shown?
3. Is there a slack coil at the pole?
4. Is slack coiled properly (≤300mm diameter)?

Respond with JSON only:
{
  "valid": true/false,
  "confidence": 0.0-1.0,
  "issues": ["issue1", "issue2"],
  "feedback": "Brief guidance for technician",
  "suggestRetake": true/false
}`,

  dome_joint: `Analyze this dome joint/splice closure photo for quality issues.

Check for:
1. Is the dome enclosure fully visible?
2. Are slack brackets visible?
3. Is slack fiber on the bracket?
4. Are cables properly labeled?

Respond with JSON only:
{
  "valid": true/false,
  "confidence": 0.0-1.0,
  "issues": ["issue1", "issue2"],
  "feedback": "Brief guidance for technician",
  "suggestRetake": true/false
}`,

  activation: `Analyze this drop cable installation photo for quality issues.

Check for:
1. Is the drop cable route visible from pole to house?
2. Is the connection point clearly shown?
3. Is there a drip loop before building entry?
4. Is cable properly secured?

Respond with JSON only:
{
  "valid": true/false,
  "confidence": 0.0-1.0,
  "issues": ["issue1", "issue2"],
  "feedback": "Brief guidance for technician",
  "suggestRetake": true/false
}`,

  general: `Analyze this fiber installation photo for quality issues.

Check for:
1. Is the subject clearly visible and in focus?
2. Is lighting adequate?
3. Is the framing appropriate (not too close/far)?
4. Are important details visible?

Respond with JSON only:
{
  "valid": true/false,
  "confidence": 0.0-1.0,
  "issues": ["issue1", "issue2"],
  "feedback": "Brief guidance for technician",
  "suggestRetake": true/false
}`,
};

interface ValidatePhotoRequest {
  image: string; // Base64 encoded image data
  workType?: 'pole_installation' | 'cable_stringing' | 'dome_joint' | 'activation' | 'general';
  projectId?: string;
  featureId?: string; // Pole number, etc.
}

interface ValidationResult {
  valid: boolean;
  confidence: number;
  issues: string[];
  feedback: string;
  suggestRetake: boolean;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['POST']);
  }

  // Guard: if the env var is not set the endpoint must not accept any traffic.
  // Without this check, QFIELD_API_KEY === undefined and any request that
  // omits the X-Api-Key header would also produce undefined, making
  // `undefined !== undefined` evaluate to false and bypassing auth entirely.
  if (!QFIELD_API_KEY) {
    log.error('QFIELD_PLUGIN_API_KEY not configured — rejecting all requests', { module: 'qfield-validate-photo' });
    return apiResponse.internalError(res, new Error('QFIELD_PLUGIN_API_KEY not configured'));
  }

  // Authenticate via API key (for plugin use)
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== QFIELD_API_KEY) {
    return apiResponse.unauthorized(res, 'Invalid or missing API key');
  }

  const startTime = Date.now();

  try {
    const { image, workType = 'general', projectId, featureId } = req.body as ValidatePhotoRequest;

    // Validate request
    if (!image) {
      return apiResponse.badRequest(res, 'Missing required field: image (base64)');
    }

    // Check image size (rough estimate - base64 is ~1.33x original)
    const imageSizeKB = Math.round(image.length / 1024);
    if (imageSizeKB > 10000) { // 10MB limit
      return apiResponse.badRequest(res, 'Image too large. Maximum 10MB.');
    }

    log.info('Real-time validation request', {
      module: 'qfield-validate-photo',
      workType,
      projectId,
      featureId,
      imageSizeKB,
    });

    // Determine mime type (assume JPEG if not specified)
    let dataUrl: string;
    if (image.startsWith('data:')) {
      dataUrl = image;
    } else {
      // Assume JPEG for raw base64
      dataUrl = `data:image/jpeg;base64,${image}`;
    }

    // Get the appropriate prompt
    const prompt = VALIDATION_PROMPTS[workType] || VALIDATION_PROMPTS.general;

    // Call VLM service
    const vlmResponse = await fetch(VLM_CHAT_ENDPOINT, {
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
        max_tokens: 400,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(VLM_TIMEOUT_REALTIME),
    });

    if (!vlmResponse.ok) {
      const errorText = await vlmResponse.text().catch(() => 'Unknown error');
      log.error('VLM service error', {
        module: 'qfield-validate-photo',
        status: vlmResponse.status,
        error: errorText.substring(0, 200),
      });

      // Return graceful degradation response
      return apiResponse.success(res, {
        valid: true, // Don't block on VLM failure
        confidence: 0,
        issues: [],
        feedback: 'AI validation unavailable. Photo saved - will be reviewed later.',
        suggestRetake: false,
        vlmError: true,
      }, 'Validation service temporarily unavailable');
    }

    const vlmResult = await vlmResponse.json();

    // Parse VLM response
    let validationResult: ValidationResult;
    try {
      const responseText = vlmResult.choices?.[0]?.message?.content || '';
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        validationResult = {
          valid: Boolean(parsed.valid),
          confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
          issues: Array.isArray(parsed.issues) ? parsed.issues : [],
          feedback: String(parsed.feedback || ''),
          suggestRetake: Boolean(parsed.suggestRetake ?? !parsed.valid),
        };
      } else {
        throw new Error('No JSON in VLM response');
      }
    } catch (parseError) {
      log.warn('Failed to parse VLM response', {
        module: 'qfield-validate-photo',
        error: parseError instanceof Error ? parseError.message : 'Parse error',
      });

      // Default response on parse failure
      validationResult = {
        valid: true,
        confidence: 0.5,
        issues: [],
        feedback: 'Could not analyze photo. Please ensure good lighting and framing.',
        suggestRetake: false,
      };
    }

    const duration = Date.now() - startTime;

    log.info('Validation complete', {
      module: 'qfield-validate-photo',
      valid: validationResult.valid,
      confidence: validationResult.confidence,
      issueCount: validationResult.issues.length,
      durationMs: duration,
    });

    return apiResponse.success(res, {
      ...validationResult,
      processingTimeMs: duration,
    }, validationResult.valid ? 'Photo validated successfully' : 'Photo needs improvement');

  } catch (error) {
    const duration = Date.now() - startTime;

    // Handle timeout specifically
    if (error instanceof Error && error.name === 'TimeoutError') {
      log.warn('VLM request timed out', {
        module: 'qfield-validate-photo',
        durationMs: duration,
      });

      return apiResponse.success(res, {
        valid: true,
        confidence: 0,
        issues: [],
        feedback: 'Validation timed out. Photo saved - will be reviewed later.',
        suggestRetake: false,
        timeout: true,
        processingTimeMs: duration,
      }, 'Validation timed out');
    }

    log.error('Validation error', {
      module: 'qfield-validate-photo',
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs: duration,
    });

    return apiResponse.internalError(res, error);
  }
}

// Increase body size limit for base64 images
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
};
