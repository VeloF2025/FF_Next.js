/**
 * Photo Fetch Service
 *
 * Robust photo fetching from OneMap with retry logic and status tracking.
 * Handles the common case where photos aren't immediately available after
 * WhatsApp submission.
 *
 * @module activate/services/photoFetchService
 */

import { log } from '@/lib/logger';
import { PhotoInput } from './categorizationVlmService';
import { photoTypeToStep } from '../utils/stepMapper';

// OneMap API host
const ONEMAP_HOST = process.env.ONEMAP_HOST || 'http://192.168.1.150:8003';

// Retry configuration
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_DELAY_MS = 2000; // 2 seconds
const DEFAULT_MAX_DELAY_MS = 30000; // 30 seconds
const BACKOFF_MULTIPLIER = 1.5;

export interface PhotoFetchResult {
  photos: PhotoInput[];
  ont_barcode: string | null;
  ups_serial: string | null;
  fetchAttempts: number;
  downloadTriggered: boolean;
  totalWaitTimeMs: number;
}

export interface PhotoFetchOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onStatusUpdate?: (status: PhotoFetchStatus) => void;
}

export interface PhotoFetchStatus {
  attempt: number;
  maxAttempts: number;
  status: 'fetching' | 'downloading' | 'waiting' | 'success' | 'failed';
  photoCount: number;
  message: string;
  waitingMs?: number;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try to fetch photos from OneMap (single attempt)
 */
async function tryFetchPhotos(dropNumber: string): Promise<{
  success: boolean;
  photos: PhotoInput[];
  ont_barcode: string | null;
  ups_serial: string | null;
  needsDownload: boolean;
  error?: string;
}> {
  try {
    const response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`);

    if (response.status === 404 || response.status === 422) {
      return {
        success: false,
        photos: [],
        ont_barcode: null,
        ups_serial: null,
        needsDownload: true,
      };
    }

    if (!response.ok) {
      return {
        success: false,
        photos: [],
        ont_barcode: null,
        ups_serial: null,
        needsDownload: false,
        error: `OneMap API error: ${response.status}`,
      };
    }

    const data = await response.json();
    const localPhotos = data.local_photos || [];

    const photos: PhotoInput[] = localPhotos.map((photo: any) => ({
      filename: photo.filename,
      url: `/api/activate/photo/${dropNumber}/${photo.filename}`,
      original_type: photo.type || null,
      original_step: photo.type ? photoTypeToStep(photo.type) : null,
    }));

    return {
      success: photos.length > 0,
      photos,
      ont_barcode: data.ont_barcode || null,
      ups_serial: data.ups_serial || null,
      needsDownload: photos.length === 0,
    };
  } catch (error) {
    return {
      success: false,
      photos: [],
      ont_barcode: null,
      ups_serial: null,
      needsDownload: false,
      error: error instanceof Error ? error.message : 'Unknown fetch error',
    };
  }
}

/**
 * Trigger photo download from OneMap
 */
async function triggerDownload(dropNumber: string): Promise<boolean> {
  try {
    const response = await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
      method: 'POST',
    });
    return response.ok;
  } catch (error) {
    log.warn('PhotoFetchService', `Download trigger failed for ${dropNumber}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Fetch photos from OneMap with robust retry logic
 *
 * This function handles the common scenario where photos aren't immediately
 * available after WhatsApp submission. It will:
 * 1. Try to fetch photos
 * 2. If not found, trigger download
 * 3. Wait and retry with exponential backoff
 * 4. Provide status updates via callback
 *
 * @param dropNumber - The DR number to fetch photos for
 * @param options - Configuration options
 * @returns Photo fetch result with metadata
 */
export async function fetchPhotosWithRetry(
  dropNumber: string,
  options: PhotoFetchOptions = {}
): Promise<PhotoFetchResult> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    onStatusUpdate,
  } = options;

  const startTime = Date.now();
  let downloadTriggered = false;
  let currentDelay = initialDelayMs;
  let lastResult: Awaited<ReturnType<typeof tryFetchPhotos>> | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Report status: fetching
    onStatusUpdate?.({
      attempt,
      maxAttempts: maxRetries,
      status: 'fetching',
      photoCount: 0,
      message: `Fetching photos (attempt ${attempt}/${maxRetries})...`,
    });

    log.debug('PhotoFetchService', `Attempt ${attempt}/${maxRetries} for ${dropNumber}`);

    // Try to fetch photos
    lastResult = await tryFetchPhotos(dropNumber);

    if (lastResult.success && lastResult.photos.length > 0) {
      // Success - we have photos
      const totalWaitTimeMs = Date.now() - startTime;

      onStatusUpdate?.({
        attempt,
        maxAttempts: maxRetries,
        status: 'success',
        photoCount: lastResult.photos.length,
        message: `Found ${lastResult.photos.length} photos`,
      });

      log.info('PhotoFetchService', `Successfully fetched ${lastResult.photos.length} photos for ${dropNumber}`, {
        attempts: attempt,
        totalWaitTimeMs,
        downloadTriggered,
      });

      return {
        photos: lastResult.photos,
        ont_barcode: lastResult.ont_barcode,
        ups_serial: lastResult.ups_serial,
        fetchAttempts: attempt,
        downloadTriggered,
        totalWaitTimeMs,
      };
    }

    // Photos not found - trigger download if needed
    if (lastResult.needsDownload && !downloadTriggered) {
      onStatusUpdate?.({
        attempt,
        maxAttempts: maxRetries,
        status: 'downloading',
        photoCount: 0,
        message: 'Triggering photo download from OneMap...',
      });

      log.info('PhotoFetchService', `Triggering download for ${dropNumber}`);
      const downloadOk = await triggerDownload(dropNumber);
      downloadTriggered = true;

      if (!downloadOk) {
        log.warn('PhotoFetchService', `Download trigger returned error for ${dropNumber}`);
      }
    }

    // If this is the last attempt, don't wait
    if (attempt >= maxRetries) {
      break;
    }

    // Wait before next attempt
    onStatusUpdate?.({
      attempt,
      maxAttempts: maxRetries,
      status: 'waiting',
      photoCount: 0,
      message: `Waiting ${Math.round(currentDelay / 1000)}s for photos to sync...`,
      waitingMs: currentDelay,
    });

    log.debug('PhotoFetchService', `Waiting ${currentDelay}ms before retry for ${dropNumber}`);
    await sleep(currentDelay);

    // Exponential backoff with cap
    currentDelay = Math.min(currentDelay * BACKOFF_MULTIPLIER, maxDelayMs);
  }

  // All retries exhausted
  const totalWaitTimeMs = Date.now() - startTime;

  onStatusUpdate?.({
    attempt: maxRetries,
    maxAttempts: maxRetries,
    status: 'failed',
    photoCount: lastResult?.photos.length || 0,
    message: lastResult?.error || 'Photos not available after all retries',
  });

  log.warn('PhotoFetchService', `Failed to fetch photos for ${dropNumber} after ${maxRetries} attempts`, {
    totalWaitTimeMs,
    downloadTriggered,
    lastError: lastResult?.error,
  });

  return {
    photos: lastResult?.photos || [],
    ont_barcode: lastResult?.ont_barcode || null,
    ups_serial: lastResult?.ups_serial || null,
    fetchAttempts: maxRetries,
    downloadTriggered,
    totalWaitTimeMs,
  };
}

/**
 * Quick check if photos exist (no retry, no download trigger)
 * Useful for UI to show status before starting full process
 */
export async function checkPhotosExist(dropNumber: string): Promise<{
  exists: boolean;
  count: number;
  needsDownload: boolean;
}> {
  const result = await tryFetchPhotos(dropNumber);
  return {
    exists: result.photos.length > 0,
    count: result.photos.length,
    needsDownload: result.needsDownload,
  };
}

/**
 * Get photo fetch status message for UI display
 */
export function getStatusMessage(status: PhotoFetchStatus): string {
  switch (status.status) {
    case 'fetching':
      return `🔍 ${status.message}`;
    case 'downloading':
      return `📥 ${status.message}`;
    case 'waiting':
      return `⏳ ${status.message}`;
    case 'success':
      return `✅ ${status.message}`;
    case 'failed':
      return `❌ ${status.message}`;
    default:
      return status.message;
  }
}
