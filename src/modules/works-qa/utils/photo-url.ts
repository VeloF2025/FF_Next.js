/**
 * Resolve a stored photo_key into a browser-loadable URL.
 *
 * pole_qa_photos collects photos from three different storage backends. The
 * key prefix distinguishes them:
 *
 *   works-qa/{project_id}/...     → Works QA upload via VF Storage (/storage/)
 *   projects/{qfield_id}/...      → QField MinIO  (construction-qa photo-proxy, source=qfield)
 *   sharepoint:...                → SharePoint Graph (construction-qa photo-proxy, source=sharepoint)
 *   anything else (e.g. lawley/...) → Historical construction-qa photos under
 *                                    /home/velo/storage/qa-photos/ (source=local)
 */
export function photoUrl(key: string): string {
  if (!key) return '';

  // Newly uploaded works-qa photos live in VF Storage — serve via the nginx /storage/ proxy
  if (key.startsWith('works-qa/')) return `/storage/${key}`;

  // Everything else is reachable via the construction-qa photo-proxy. Map the prefix
  // to the source param the proxy expects.
  const source = key.startsWith('projects/')   ? 'qfield'
              : key.startsWith('sharepoint:') ? 'sharepoint'
              :                                 'local';
  return `/api/construction-qa/photo-proxy?key=${encodeURIComponent(key)}&source=${source}`;
}
