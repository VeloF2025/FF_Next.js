/**
 * Image fetcher used by the VLM categorization client.
 *
 * Extracted from categorizationVlmService.ts to keep that file under the
 * 300-line CLAUDE.md limit. Handles the proxy-URL → internal-OneMap-URL
 * rewrite and the base64 encoding the VLM API expects.
 *
 * Other modules (vlmQaValidationService, fotoVlmService, reportCaptionService)
 * each maintain their own copies of `fetchImageAsBase64` — those are
 * intentionally separate and are not consolidated here.
 */

import { log } from '@/lib/logger';

const ONEMAP_INTERNAL_URL =
  process.env.ONEMAP_INTERNAL_URL || 'http://100.96.203.105:8003';

/**
 * Convert proxy URL to internal OneMap URL for server-side fetching.
 *
 * Proxy URL format:   /api/activate/photo/{drNumber}/{filename}
 * Internal URL format: {ONEMAP_INTERNAL_URL}/api/photo/{drNumber}/{filename}
 */
export function resolveImageUrl(imageUrl: string): string {
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }

  const proxyPattern = /^\/api\/activate\/photo\/(.+)$/;
  const match = imageUrl.match(proxyPattern);

  if (match) {
    const internalUrl = `${ONEMAP_INTERNAL_URL}/api/photo/${match[1]}`;
    log.debug(
      `Resolved proxy URL to internal: ${imageUrl} → ${internalUrl}`,
      undefined,
      'CategorizationVlm',
    );
    return internalUrl;
  }

  log.warn(
    `Unrecognized URL format, using as-is: ${imageUrl}`,
    undefined,
    'CategorizationVlm',
  );
  return imageUrl;
}

/**
 * Fetch an image and convert to base64.
 *
 * Handles both:
 * - Relative proxy URLs (resolved via resolveImageUrl)
 * - Absolute URLs (used directly)
 */
export async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  const resolvedUrl = resolveImageUrl(imageUrl);

  try {
    const response = await fetch(resolvedUrl);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch image: ${response.status} from ${resolvedUrl}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer.toString('base64');
  } catch (error) {
    log.error(
      `Failed to fetch/encode image ${resolvedUrl}: ${error}`,
      undefined,
      'CategorizationVlm',
    );
    throw error;
  }
}
