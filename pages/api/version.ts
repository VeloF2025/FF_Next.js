/**
 * Version API Endpoint
 * Returns current build version for cache busting
 *
 * IMPORTANT: Version must be stable (same value for same deployment)
 * Using Date.now() would cause constant "new version" banners!
 *
 * Security: execSync('git rev-parse') fallback removed — it exposes the git
 * commit hash to unauthenticated callers via process execution and is
 * redundant when NEXT_PUBLIC_BUILD_VERSION is set at build time.
 * Node version is also not included in the response.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';

// Cache the version at module load time (once per server start)
let cachedVersion: string | null = null;

function getVersion(): string {
  if (cachedVersion) return cachedVersion;

  // Use the build-time env var (set during CI/deploy) — only source of truth
  cachedVersion = process.env.NEXT_PUBLIC_BUILD_VERSION || 'dev';
  return cachedVersion;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const version = getVersion();

  // Never cache this endpoint
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  return res.status(200).json({
    version,
    timestamp: new Date().toISOString(),
  });
}
