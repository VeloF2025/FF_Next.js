/**
 * Resolve a stored photo_key into a browser-loadable URL.
 *
 * Routes through the construction-qa photo proxy because it already knows
 * how to fetch all three sources (QField MinIO, SharePoint Graph, local
 * filesystem) and Works QA inherits the same key formats:
 *   - projects/...                  → QField MinIO
 *   - sharepoint:...                → SharePoint Graph API
 *   - everything else (e.g. "lawley/LAW.P.E410/...") → local VF Storage
 */
export function photoUrl(key: string): string {
  if (!key) return '';
  const source = detectSource(key);
  return `/api/construction-qa/photo-proxy?key=${encodeURIComponent(key)}&source=${source}`;
}

function detectSource(key: string): 'qfield' | 'sharepoint' | 'upload' {
  if (key.startsWith('projects/')) return 'qfield';
  if (key.startsWith('sharepoint:')) return 'sharepoint';
  return 'upload';
}
