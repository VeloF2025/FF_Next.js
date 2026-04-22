/**
 * Activate photo source helpers — reusable across /api/activate/fetch-photos
 * and the NOC Historical Photos aggregator.
 *
 * Each source throws on failure so callers can layer their own fallback or
 * Promise.allSettled behaviour. fetchPhotosWithFallback() provides the
 * OneMap → BOSS → Local chain originally embedded in fetch-photos.ts.
 */

import { log } from '@/lib/logger';
import { photoTypeToStep } from '@/modules/activate/utils/stepMapper';

export interface SourcePhoto {
  filename: string;
  step: number | null;
  url: string;
  size?: number;
  modified?: number;
  original_type?: string;
}

export interface SourcePhotoFetchResult {
  source: 'onemap' | 'boss' | 'local';
  photos: SourcePhoto[];
  count: number;
  ont_barcode?: string | null;
  ups_serial?: string | null;
}

const ONEMAP_HOST = 'http://100.96.203.105:8003';
const BOSS_HOST = 'http://192.168.1.150:8001';
const DEFAULT_TIMEOUT_MS = 5000;

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchSourceOptions {
  skipCategorization?: boolean;
  timeoutMs?: number;
}

/**
 * Fetch from OneMap GIS (port 8003). Triggers a download if the record is
 * missing, then re-fetches. Returns photos via the local
 * /api/activate/photo/{DR}/{filename} proxy so LAN IPs / mixed-content don't
 * block rendering.
 */
export async function fetchFromOneMap(
  dropNumber: string,
  options: FetchSourceOptions = {}
): Promise<SourcePhotoFetchResult> {
  const { skipCategorization = false, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  let response = await fetchWithTimeout(`${ONEMAP_HOST}/api/record/${dropNumber}`, undefined, timeoutMs);

  if (response.status === 404 || response.status === 422) {
    log.info(`OneMap record not found for ${dropNumber}, triggering download`);
    const downloadResponse = await fetchWithTimeout(
      `${ONEMAP_HOST}/api/download/${dropNumber}`,
      { method: 'POST' },
      timeoutMs
    );
    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text();
      log.warn(`OneMap download failed for ${dropNumber}`, {
        status: downloadResponse.status,
        error: errorText,
      });
      throw new Error(`OneMap download failed: ${downloadResponse.status}`);
    }
    response = await fetchWithTimeout(`${ONEMAP_HOST}/api/record/${dropNumber}`, undefined, timeoutMs);
  }

  if (!response.ok) {
    throw new Error(`OneMap API error: ${response.status}`);
  }

  let data = await response.json();
  let localPhotos: Array<Record<string, unknown>> = Array.isArray(data.local_photos) ? data.local_photos : [];

  if (localPhotos.length === 0 && typeof data.photo_count === 'number' && data.photo_count > 0) {
    log.info(`OneMap record exists but no local photos for ${dropNumber}, retrying download`);
    const downloadResponse = await fetchWithTimeout(
      `${ONEMAP_HOST}/api/download/${dropNumber}`,
      { method: 'POST' },
      timeoutMs
    );
    if (downloadResponse.ok) {
      const retryResponse = await fetchWithTimeout(
        `${ONEMAP_HOST}/api/record/${dropNumber}`,
        undefined,
        timeoutMs
      );
      if (retryResponse.ok) {
        data = await retryResponse.json();
        localPhotos = Array.isArray(data.local_photos) ? data.local_photos : [];
      }
    }
  }

  const photos: SourcePhoto[] = localPhotos.map((raw) => {
    const type = typeof raw.type === 'string' ? raw.type : undefined;
    const filename = String(raw.filename ?? '');
    return {
      filename,
      step: skipCategorization ? null : (type ? photoTypeToStep(type) ?? 0 : 0),
      url: `/api/activate/photo/${dropNumber}/${filename}`,
      size: typeof raw.size === 'number' ? raw.size : undefined,
      modified: typeof raw.modified === 'number' ? raw.modified : undefined,
      original_type: type,
    };
  });

  return {
    source: 'onemap',
    photos,
    count: photos.length,
    ont_barcode: (data.ont_barcode as string) || null,
    ups_serial: (data.ups_serial as string) || null,
  };
}

/**
 * Fetch from BOSS VPS (port 8001).
 */
export async function fetchFromBossApi(
  dropNumber: string,
  options: FetchSourceOptions = {}
): Promise<SourcePhotoFetchResult> {
  const { skipCategorization = false, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const response = await fetchWithTimeout(`${BOSS_HOST}/api/photos/${dropNumber}`, undefined, timeoutMs);
  if (!response.ok) {
    throw new Error(`BOSS API error: ${response.status}`);
  }

  const data = await response.json();
  const rawPhotos: Array<Record<string, unknown>> = Array.isArray(data.photos) ? data.photos : [];

  const photos: SourcePhoto[] = rawPhotos.map((raw) => {
    const type = typeof raw.type === 'string' ? raw.type : undefined;
    return {
      filename: String(raw.filename ?? ''),
      step: skipCategorization ? null : (type ? photoTypeToStep(type) ?? 0 : 0),
      url: String(raw.url ?? ''),
      size: typeof raw.size === 'number' ? raw.size : undefined,
      modified: typeof raw.modified === 'number' ? raw.modified : undefined,
      original_type: type,
    };
  });

  return {
    source: 'boss',
    photos,
    count: photos.length,
  };
}

/**
 * Local filesystem cache fallback — not yet implemented (matches original
 * fetch-photos.ts behaviour: always throws).
 */
export async function fetchFromLocalCache(_dropNumber: string): Promise<SourcePhotoFetchResult> {
  throw new Error('Local cache not yet implemented');
}

/**
 * Multi-source fallback: OneMap → BOSS → Local.
 * Returns an empty 'local' result if every source fails so callers see
 * graceful degradation instead of a thrown error.
 */
export async function fetchPhotosWithFallback(
  dropNumber: string,
  options: FetchSourceOptions = {}
): Promise<SourcePhotoFetchResult> {
  try {
    log.info(`Trying OneMap for ${dropNumber}`);
    return await fetchFromOneMap(dropNumber, options);
  } catch (error) {
    log.warn(`OneMap failed for ${dropNumber}`, { error });
  }

  try {
    log.info(`Trying BOSS API for ${dropNumber}`);
    return await fetchFromBossApi(dropNumber, options);
  } catch (error) {
    log.warn(`BOSS API failed for ${dropNumber}`, { error });
  }

  try {
    log.info(`Trying local cache for ${dropNumber}`);
    return await fetchFromLocalCache(dropNumber);
  } catch (error) {
    log.warn(`All Activate photo sources failed for ${dropNumber}`, { error });
    return { source: 'local', photos: [], count: 0 };
  }
}

/**
 * Fetch from a specific source (used by /api/activate/fetch-photos when
 * a forceSource query param is supplied for testing).
 */
export async function fetchFromSpecificSource(
  dropNumber: string,
  source: 'onemap' | 'boss' | 'local',
  options: FetchSourceOptions = {}
): Promise<SourcePhotoFetchResult> {
  switch (source) {
    case 'onemap':
      return fetchFromOneMap(dropNumber, options);
    case 'boss':
      return fetchFromBossApi(dropNumber, options);
    case 'local':
      return fetchFromLocalCache(dropNumber);
    default:
      throw new Error(`Unknown source: ${source}`);
  }
}
