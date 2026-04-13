/**
 * Fleet VLM Client
 *
 * Purpose: Shared HTTP client, image resizing, error class, and health check
 * for the fleet Vision Language Model service.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import sharp from 'sharp';
import { neon } from '@/lib/db-neon';
import { VlmAnalysisType } from '../types/check-in.types';
import { VLM_API_URL as _VLM_URL, VLM_FLEET_MODEL, VLM_TIMEOUT_DEFAULT, VLM_MAX_IMAGE_WIDTH, VLM_MAX_IMAGE_HEIGHT, VLM_JPEG_QUALITY, VLM_MAX_TOKENS_QUICK } from '@/lib/vlm';

// Database connection for calibration queries
export const sql = neon(process.env.DATABASE_URL!);

// ============================================================================
// CONFIGURATION
// ============================================================================

// Image size limits for VLM processing
// Large images (4K+) cause token limit errors and incorrect readings

// ============================================================================
// ERROR CLASS
// ============================================================================

/**
 * Typed error for VLM API failures.
 */
export class FleetVlmError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'FleetVlmError';
  }
}

// ============================================================================
// IMAGE RESIZING
// ============================================================================

/**
 * Resize image to fit within VLM limits.
 * CRITICAL: 4K images (4032x3024) cause VLM to misread odometer/fuel readings.
 * Resizing to ~1280x960 fixes accuracy issues.
 */
export async function resizeImageForVlm(base64Image: string): Promise<string> {
  try {
    const inputBuffer = Buffer.from(base64Image, 'base64');

    const metadata = await sharp(inputBuffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    const format = metadata.format || 'unknown';

    const needsResize = width > VLM_MAX_IMAGE_WIDTH || height > VLM_MAX_IMAGE_HEIGHT;
    const needsConvert = format !== 'jpeg' && format !== 'jpg';

    if (!needsResize && !needsConvert) {
      log.info(
        'FleetVlmService',
        `Image ${width}x${height} JPEG already within limits, skipping`
      );
      return base64Image;
    }

    log.info(
      'FleetVlmService',
      `Processing image ${width}x${height} ${format} (resize: ${needsResize}, convert: ${needsConvert})`
    );

    let pipeline = sharp(inputBuffer);
    if (needsResize) {
      pipeline = pipeline.resize(VLM_MAX_IMAGE_WIDTH, VLM_MAX_IMAGE_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
    const outputBuffer = await pipeline
      .jpeg({ quality: VLM_JPEG_QUALITY })
      .toBuffer();

    const outputBase64 = outputBuffer.toString('base64');

    const originalSize = Math.round(inputBuffer.length / 1024);
    const outputSize = Math.round(outputBuffer.length / 1024);
    log.info(
      'FleetVlmService',
      `Image processed: ${originalSize}KB -> ${outputSize}KB (${format} -> jpeg)`
    );

    return outputBase64;
  } catch (error) {
    log.error('FleetVlmService', `Image processing failed: ${error}`);
    throw new FleetVlmError(
      `Failed to process image for VLM: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'IMAGE_PROCESSING_ERROR',
      error
    );
  }
}

// ============================================================================
// HTTP CLIENT
// ============================================================================

/**
 * Call VLM API with a single image and prompt.
 * IMPORTANT: Images are automatically resized to prevent token limit errors.
 */
export async function callVlmApi(
  base64Image: string,
  prompt: string,
  analysisType: VlmAnalysisType
): Promise<string> {
  const resizedImage = await resizeImageForVlm(base64Image);

  const requestBody = {
    model: VLM_FLEET_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${resizedImage}`,
            },
          },
        ],
      },
    ],
    max_tokens: VLM_MAX_TOKENS_QUICK,
    temperature: 0.1, // Low temperature for consistent extraction
  };

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_DEFAULT);

    const response = await fetch(`${_VLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new FleetVlmError(
        `VLM API returned ${response.status}: ${errorText}`,
        `VLM_HTTP_${response.status}`,
        errorText
      );
    }

    const data = await response.json();
    const processingTime = Date.now() - startTime;

    log.info(
      'FleetVlmService',
      `${analysisType} VLM call completed in ${processingTime}ms`
    );

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new FleetVlmError('No content in VLM response', 'NO_CONTENT');
    }

    return content;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new FleetVlmError('VLM API request timed out', 'VLM_TIMEOUT');
    }
    if (error instanceof FleetVlmError) {
      throw error;
    }
    throw new FleetVlmError(
      `VLM API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'VLM_API_ERROR',
      error
    );
  }
}

// ============================================================================
// JSON PARSING
// ============================================================================

/**
 * Parse JSON from VLM response (handles markdown code blocks).
 */
export function parseVlmJson<T>(content: string): T {
  const jsonMatch =
    content.match(/```json\n([\s\S]*?)\n```/) ||
    content.match(/```\n([\s\S]*?)\n```/) ||
    [null, content];

  const jsonStr = (jsonMatch[1] || content).trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    log.error('FleetVlmService', `Failed to parse VLM JSON: ${content}`);
    throw new FleetVlmError('Invalid JSON in VLM response', 'PARSE_ERROR');
  }
}

// ============================================================================
// CALIBRATION HELPERS
// ============================================================================

/**
 * Calibration data for a vehicle.
 */
export interface VehicleCalibration {
  id: string;
  vehicleId: string;
  calibratedAt: string;
  calibratedByName: string | null;
  baselineOdometer: number;
  baselineFuelLevel: number;
  dashboardPhotoUrl: string | null;
  vlmLearningStatus: 'pending' | 'learning' | 'ready';
}

/**
 * Fetch active calibration data for a vehicle.
 * Used for VLM validation and few-shot learning context.
 */
export async function getVehicleCalibration(
  vehicleId: string
): Promise<VehicleCalibration | null> {
  try {
    const result = await sql`
      SELECT
        id, vehicle_id, calibrated_at, calibrated_by_name,
        baseline_odometer, baseline_fuel_level,
        dashboard_photo_url, vlm_learning_status
      FROM fleet_vehicle_calibration
      WHERE vehicle_id = ${vehicleId} AND is_active = true
      LIMIT 1
    `;

    if (result.length === 0) {
      return null;
    }

    const row = result[0]!; // Guaranteed by length check above
    return {
      id: row.id,
      vehicleId: row.vehicle_id,
      calibratedAt: row.calibrated_at,
      calibratedByName: row.calibrated_by_name,
      baselineOdometer: row.baseline_odometer,
      baselineFuelLevel: row.baseline_fuel_level,
      dashboardPhotoUrl: row.dashboard_photo_url,
      vlmLearningStatus: row.vlm_learning_status || 'pending',
    };
  } catch (error) {
    log.error('FleetVlmService', `Failed to fetch calibration: ${error}`);
    return null;
  }
}

/**
 * Fetch reference photo as base64 for few-shot learning.
 * Returns null if photo not available or fetch fails.
 */
export async function fetchCalibrationPhotoBase64(
  photoUrl: string | null
): Promise<string | null> {
  if (!photoUrl) return null;

  try {
    const fullUrl = photoUrl.startsWith('http')
      ? photoUrl
      : `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}${photoUrl}`;

    const response = await fetch(fullUrl, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      log.warn(
        'FleetVlmService',
        `Failed to fetch calibration photo: ${response.status}`
      );
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString('base64');
  } catch (error) {
    log.error('FleetVlmService', `Error fetching calibration photo: ${error}`);
    return null;
  }
}

/**
 * Update calibration VLM learning status.
 * Call after successful readings to mark calibration as 'ready'.
 */
export async function updateCalibrationLearningStatus(
  calibrationId: string,
  status: 'pending' | 'learning' | 'ready'
): Promise<void> {
  try {
    await sql`
      UPDATE fleet_vehicle_calibration
      SET vlm_learning_status = ${status}
      WHERE id = ${calibrationId}
    `;
    log.info(
      'FleetVlmService',
      `Updated calibration ${calibrationId} learning status to ${status}`
    );
  } catch (error) {
    log.error(
      'FleetVlmService',
      `Failed to update calibration status: ${error}`
    );
  }
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Check VLM service health.
 *
 * @returns true if VLM service is available and the expected model is loaded
 */
export async function checkFleetVlmHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${_VLM_URL}/v1/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    const hasModel = data.data?.some(
      (m: { id: string }) => m.id === VLM_FLEET_MODEL || false /* removed model-specific check */
    );

    if (!hasModel) {
      log.warn('FleetVlmService', `${VLM_FLEET_MODEL} model not found in vLLM`);
    }

    return hasModel;
  } catch (error) {
    log.error('FleetVlmService', `VLM health check failed: ${error}`);
    return false;
  }
}
