/**
 * Version API Endpoint
 * Returns current build version for cache busting
 *
 * IMPORTANT: Version must be stable (same value for same deployment)
 * Using Date.now() would cause constant "new version" banners!
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { execSync } from 'child_process';

// Cache the version at module load time (once per server start)
let cachedVersion: string | null = null;

function getVersion(): string {
  if (cachedVersion) return cachedVersion;

  // Priority 1: Environment variable (set during build/deploy)
  if (process.env.NEXT_PUBLIC_BUILD_VERSION) {
    cachedVersion = process.env.NEXT_PUBLIC_BUILD_VERSION;
    return cachedVersion;
  }

  // Priority 2: Git commit hash (stable per deployment)
  try {
    cachedVersion = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    return cachedVersion;
  } catch {
    // Git not available
  }

  // Priority 3: Fallback to a static value (won't trigger updates)
  cachedVersion = 'dev';
  return cachedVersion;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
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
