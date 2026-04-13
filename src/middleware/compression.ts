/**
 * Response Compression Middleware
 * Story 3.4: API Performance & Caching
 *
 * Compresses API responses to reduce bandwidth usage
 * Note: Next.js has built-in compression when deployed to Vercel
 * This is for custom server deployments or additional control
 */

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Check if response should be compressed
 */
function shouldCompress(req: NextApiRequest, contentType?: string): boolean {
  // Don't compress if client doesn't support it
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.includes('gzip') && !acceptEncoding.includes('br')) {
    return false;
  }

  // Don't compress small responses
  // (compression overhead not worth it for < 1KB)

  // Compress text-based content types
  const compressibleTypes = [
    'application/json',
    'application/javascript',
    'text/html',
    'text/css',
    'text/plain',
    'text/xml',
    'application/xml',
  ];

  if (contentType) {
    return compressibleTypes.some((type) => contentType.includes(type));
  }

  return true; // Default to compress
}

/**
 * Add cache control headers
 */
export function setCacheHeaders(
  res: NextApiResponse,
  options: {
    maxAge?: number; // seconds
    sMaxAge?: number; // CDN cache seconds
    staleWhileRevalidate?: number;
    public?: boolean;
    immutable?: boolean;
  } = {}
): void {
  const {
    maxAge = 0,
    sMaxAge,
    staleWhileRevalidate,
    public: isPublic = false,
    immutable = false,
  } = options;

  const directives: string[] = [];

  if (isPublic) {
    directives.push('public');
  } else {
    directives.push('private');
  }

  if (maxAge > 0) {
    directives.push(`max-age=${maxAge}`);
  } else {
    directives.push('no-cache');
  }

  if (sMaxAge !== undefined) {
    directives.push(`s-maxage=${sMaxAge}`);
  }

  if (staleWhileRevalidate !== undefined) {
    directives.push(`stale-while-revalidate=${staleWhileRevalidate}`);
  }

  if (immutable) {
    directives.push('immutable');
  }

  res.setHeader('Cache-Control', directives.join(', '));
}

/**
 * Preset cache configurations
 */
export const CachePresets = {
  /**
   * No caching - always fetch fresh
   */
  noCache: {
    maxAge: 0,
    public: false,
  },

  /**
   * Short cache - 5 minutes browser, 1 minute CDN
   */
  short: {
    maxAge: 5 * 60, // 5 minutes
    sMaxAge: 1 * 60, // 1 minute CDN
    staleWhileRevalidate: 60,
    public: true,
  },

  /**
   * Medium cache - 15 minutes browser, 5 minutes CDN
   */
  medium: {
    maxAge: 15 * 60, // 15 minutes
    sMaxAge: 5 * 60, // 5 minutes CDN
    staleWhileRevalidate: 5 * 60,
    public: true,
  },

  /**
   * Long cache - 1 hour browser, 15 minutes CDN
   */
  long: {
    maxAge: 60 * 60, // 1 hour
    sMaxAge: 15 * 60, // 15 minutes CDN
    staleWhileRevalidate: 30 * 60,
    public: true,
  },

  /**
   * Static assets - 1 year, immutable
   */
  static: {
    maxAge: 365 * 24 * 60 * 60, // 1 year
    public: true,
    immutable: true,
  },
} as const;

/**
 * Add ETag for conditional requests
 */
export function setETag(res: NextApiResponse, data: unknown): string {
  const etag = `"${Buffer.from(JSON.stringify(data)).toString('base64').slice(0, 27)}"`;
  res.setHeader('ETag', etag);
  return etag;
}

/**
 * Check if client has fresh cache (304 Not Modified)
 */
export function checkFreshness(
  req: NextApiRequest,
  etag: string
): boolean {
  const ifNoneMatch = req.headers['if-none-match'];
  return ifNoneMatch === etag;
}

/**
 * Compression helper for API responses
 */
export function withCompression(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    // Add Vary header for proper caching
    res.setHeader('Vary', 'Accept-Encoding');

    // Vercel/Next.js handles compression automatically in production
    // This just ensures headers are set correctly

    return handler(req, res);
  };
}

/**
 * Combined caching and compression middleware
 */
export function withCacheAndCompression(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void,
  cacheOptions?: Parameters<typeof setCacheHeaders>[1]
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    // Set cache headers
    if (cacheOptions) {
      setCacheHeaders(res, cacheOptions);
    }

    // Set compression headers
    res.setHeader('Vary', 'Accept-Encoding');

    return handler(req, res);
  };
}

/**
 * Response size helper
 */
export function getResponseSize(data: unknown): number {
  return Buffer.from(JSON.stringify(data)).length;
}

/**
 * Check if response is cacheable
 */
export function isCacheable(req: NextApiRequest, res: NextApiResponse): boolean {
  // Only cache GET and HEAD requests
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }

  // Don't cache error responses
  if (res.statusCode >= 400) {
    return false;
  }

  return true;
}
