/**
 * Resolve a stored photo_key into a browser-loadable URL.
 *
 * - QField paths (start with `projects/`) come from QFieldCloud's MinIO bucket
 *   and must go through the photo-proxy endpoint.
 * - VF Storage paths (everything else, e.g. `works-qa/{project_id}/...`) are
 *   served by the nginx /storage/ proxy.
 */
export function photoUrl(key: string): string {
  if (!key) return '';
  if (key.startsWith('projects/')) {
    return `/api/qfield/photo-proxy?key=${encodeURIComponent(key)}`;
  }
  return `/storage/${key}`;
}
