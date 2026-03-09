/**
 * Image Preprocessing Service
 *
 * Purpose: Detect and fix image quality issues before VLM processing
 * - Blur detection using Laplacian variance
 * - Selective deblurring with NAFNet
 * - Image optimization (resize, enhance)
 *
 * Status: WORKING - Phase for improved VLM accuracy
 *
 * NLNH Confidence: HIGH
 */

import sharp from 'sharp';
import { log } from '@/lib/logger';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Blur detection threshold (Laplacian variance)
 * - Below this = blurry
 * - Above this = sharp
 *
 * Typical values:
 * - Very blurry: < 50
 * - Slightly blurry: 50-100
 * - Acceptable: 100-300
 * - Sharp: > 300
 */
const BLUR_THRESHOLD = 100;

/**
 * NAFNet deblur service endpoint (on VPS)
 */
const NAFNET_API_URL = process.env.NAFNET_API_URL || 'http://100.96.203.105:8101';
const NAFNET_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Maximum image size for processing (to avoid memory issues)
 */
const MAX_PROCESS_WIDTH = 1280;
const MAX_PROCESS_HEIGHT = 960;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Blur detection result
 */
export interface BlurDetectionResult {
  /** Is the image considered blurry? */
  isBlurry: boolean;
  /** Laplacian variance score (higher = sharper) */
  score: number;
  /** Threshold used for determination */
  threshold: number;
  /** Human-readable assessment */
  assessment: 'very_blurry' | 'slightly_blurry' | 'acceptable' | 'sharp';
  /** Processing time in ms */
  processingTimeMs: number;
}

/**
 * Deblur result
 */
export interface DeblurResult {
  /** Whether deblurring was successful */
  success: boolean;
  /** Deblurred image as base64 (or original if failed/not needed) */
  imageBase64: string;
  /** Was the image actually deblurred? */
  wasDeblurred: boolean;
  /** Blur score before deblurring */
  originalScore: number;
  /** Blur score after deblurring (if applicable) */
  newScore?: number;
  /** Processing time in ms */
  processingTimeMs: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Preprocessing result
 */
export interface PreprocessResult {
  /** Preprocessed image as base64 */
  imageBase64: string;
  /** Original blur detection */
  blurDetection: BlurDetectionResult;
  /** Deblur result (if blur was detected) */
  deblur?: DeblurResult;
  /** Was any preprocessing applied? */
  wasPreprocessed: boolean;
  /** Total processing time in ms */
  totalProcessingTimeMs: number;
}

// ============================================================================
// BLUR DETECTION
// ============================================================================

/**
 * Detect blur in an image using Laplacian variance method
 *
 * The Laplacian operator is a second-derivative operator that highlights
 * regions of rapid intensity change (edges). Sharp images have high
 * variance in the Laplacian, while blurry images have low variance.
 *
 * @param imageBase64 - Base64 encoded image
 * @returns BlurDetectionResult with score and assessment
 */
export async function detectBlur(imageBase64: string): Promise<BlurDetectionResult> {
  const startTime = Date.now();

  try {
    // Decode base64 to buffer
    const imageBuffer = Buffer.from(imageBase64, 'base64');

    // Convert to grayscale and resize for consistent processing
    const { data, info } = await sharp(imageBuffer)
      .resize(640, 480, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = info;

    // Apply Laplacian kernel: [0, 1, 0], [1, -4, 1], [0, 1, 0]
    // We'll compute variance of the Laplacian
    let sum = 0;
    let sumSq = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;

        // Get pixel values for Laplacian kernel
        const center = data[idx];
        const top = data[(y - 1) * width + x];
        const bottom = data[(y + 1) * width + x];
        const left = data[y * width + (x - 1)];
        const right = data[y * width + (x + 1)];

        // Laplacian: 4*center - top - bottom - left - right
        // Using negative kernel for edge detection
        const laplacian = 4 * (center ?? 0) - (top ?? 0) - (bottom ?? 0) - (left ?? 0) - (right ?? 0);

        sum += laplacian;
        sumSq += laplacian * laplacian;
        count++;
      }
    }

    // Calculate variance
    const mean = sum / count;
    const variance = sumSq / count - mean * mean;

    // Score is the variance (higher = sharper)
    const score = Math.abs(variance);

    // Determine assessment
    let assessment: BlurDetectionResult['assessment'];
    if (score < 50) {
      assessment = 'very_blurry';
    } else if (score < BLUR_THRESHOLD) {
      assessment = 'slightly_blurry';
    } else if (score < 300) {
      assessment = 'acceptable';
    } else {
      assessment = 'sharp';
    }

    const isBlurry = score < BLUR_THRESHOLD;

    const processingTimeMs = Date.now() - startTime;

    log.debug(`Blur detection: score=${score.toFixed(1)}, assessment=${assessment}`, {
      isBlurry,
      processingTimeMs,
    }, 'ImagePreprocess');

    return {
      isBlurry,
      score,
      threshold: BLUR_THRESHOLD,
      assessment,
      processingTimeMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Blur detection failed: ${message}`, undefined, 'ImagePreprocess');

    // Return conservative estimate (not blurry) on error
    return {
      isBlurry: false,
      score: 999,
      threshold: BLUR_THRESHOLD,
      assessment: 'sharp',
      processingTimeMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// DEBLURRING (NAFNet)
// ============================================================================

/**
 * Deblur an image using NAFNet model on VPS
 *
 * NAFNet (Nonlinear Activation Free Network) is a state-of-the-art
 * image restoration model that can effectively remove blur.
 *
 * @param imageBase64 - Base64 encoded blurry image
 * @returns DeblurResult with deblurred image
 */
export async function deblurImage(imageBase64: string): Promise<DeblurResult> {
  const startTime = Date.now();

  try {
    // First, detect how blurry the image is
    const blurResult = await detectBlur(imageBase64);

    // If not blurry, return original
    if (!blurResult.isBlurry) {
      return {
        success: true,
        imageBase64,
        wasDeblurred: false,
        originalScore: blurResult.score,
        processingTimeMs: Date.now() - startTime,
      };
    }

    log.info(`Deblurring image (score: ${blurResult.score.toFixed(1)})`, undefined, 'ImagePreprocess');

    // Resize image if too large (NAFNet has memory limits)
    const resizedBuffer = await sharp(Buffer.from(imageBase64, 'base64'))
      .resize(MAX_PROCESS_WIDTH, MAX_PROCESS_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toBuffer();

    const resizedBase64 = resizedBuffer.toString('base64');

    // Call NAFNet API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NAFNET_TIMEOUT_MS);

    try {
      const response = await fetch(`${NAFNET_API_URL}/deblur`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: resizedBase64 }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`NAFNet API returned ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      if (!result.success || !result.image) {
        throw new Error(result.error || 'NAFNet returned no image');
      }

      // Check blur score of deblurred image
      const newBlurResult = await detectBlur(result.image);

      log.info(`Deblurred: ${blurResult.score.toFixed(1)} → ${newBlurResult.score.toFixed(1)}`, undefined, 'ImagePreprocess');

      return {
        success: true,
        imageBase64: result.image,
        wasDeblurred: true,
        originalScore: blurResult.score,
        newScore: newBlurResult.score,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Deblur failed: ${message}`, undefined, 'ImagePreprocess');

    // Return original image on error
    return {
      success: false,
      imageBase64,
      wasDeblurred: false,
      originalScore: 0,
      processingTimeMs: Date.now() - startTime,
      error: message,
    };
  }
}

// ============================================================================
// COMBINED PREPROCESSING
// ============================================================================

/**
 * Run full preprocessing pipeline on an image
 *
 * 1. Detect blur
 * 2. If blurry, attempt deblur with NAFNet
 * 3. Return preprocessed image (or original if not needed/failed)
 *
 * @param imageBase64 - Base64 encoded image
 * @param options - Preprocessing options
 * @returns PreprocessResult with processed image
 */
export async function preprocessImage(
  imageBase64: string,
  options?: {
    /** Skip deblurring even if blur detected */
    skipDeblur?: boolean;
    /** Custom blur threshold */
    blurThreshold?: number;
  }
): Promise<PreprocessResult> {
  const startTime = Date.now();

  try {
    // Step 1: Detect blur
    const blurDetection = await detectBlur(imageBase64);

    // If not blurry or deblur disabled, return original
    if (!blurDetection.isBlurry || options?.skipDeblur) {
      return {
        imageBase64,
        blurDetection,
        wasPreprocessed: false,
        totalProcessingTimeMs: Date.now() - startTime,
      };
    }

    // Step 2: Attempt deblur
    const deblurResult = await deblurImage(imageBase64);

    return {
      imageBase64: deblurResult.imageBase64,
      blurDetection,
      deblur: deblurResult,
      wasPreprocessed: deblurResult.wasDeblurred,
      totalProcessingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Preprocessing failed: ${message}`, undefined, 'ImagePreprocess');

    // Return original on error
    return {
      imageBase64,
      blurDetection: {
        isBlurry: false,
        score: 999,
        threshold: BLUR_THRESHOLD,
        assessment: 'sharp',
        processingTimeMs: 0,
      },
      wasPreprocessed: false,
      totalProcessingTimeMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Optimize image for VLM processing
 * - Resize to max dimensions
 * - Convert to JPEG with good quality
 * - Optionally enhance contrast
 *
 * @param imageBase64 - Base64 encoded image
 * @param options - Optimization options
 * @returns Optimized image as base64
 */
export async function optimizeForVlm(
  imageBase64: string,
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    enhanceContrast?: boolean;
  }
): Promise<string> {
  const maxWidth = options?.maxWidth ?? MAX_PROCESS_WIDTH;
  const maxHeight = options?.maxHeight ?? MAX_PROCESS_HEIGHT;
  const quality = options?.quality ?? 85;

  try {
    let pipeline = sharp(Buffer.from(imageBase64, 'base64'))
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      });

    // Optional contrast enhancement
    if (options?.enhanceContrast) {
      pipeline = pipeline.normalize();
    }

    const optimizedBuffer = await pipeline.jpeg({ quality }).toBuffer();

    return optimizedBuffer.toString('base64');
  } catch (error) {
    log.warn(`Optimization failed, returning original: ${error}`, undefined, 'ImagePreprocess');
    return imageBase64;
  }
}

/**
 * Get image dimensions without fully decoding
 *
 * @param imageBase64 - Base64 encoded image
 * @returns Image dimensions or null on error
 */
export async function getImageDimensions(
  imageBase64: string
): Promise<{ width: number; height: number } | null> {
  try {
    const metadata = await sharp(Buffer.from(imageBase64, 'base64')).metadata();
    if (metadata.width && metadata.height) {
      return { width: metadata.width, height: metadata.height };
    }
    return null;
  } catch {
    return null;
  }
}
