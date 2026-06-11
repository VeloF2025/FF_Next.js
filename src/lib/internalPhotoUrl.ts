/**
 * Resolve an app-relative photo proxy URL to its backend source URL.
 *
 * Gallery example photos are stored as `/api/activate/photo/{DR}/{filename}`
 * — the browser-facing proxy route, which is auth-protected (withAuth).
 * Server-side consumers (vlmGallery, scripts) have no session cookie, so
 * fetching the proxy URL returns 401 and the photo is silently dropped.
 * They must fetch the backend source directly instead.
 *
 * Routing mirrors pages/api/activate/photo/[...path].ts:
 *  - WA photos (wa_*)  → VPS photo viewer  :8866 /photos/{DR}/{filename}
 *  - 1Map photos       → Velocity server   :8003 /api/photo/{DR}/{filename}
 *
 * Absolute URLs and anything that doesn't match the proxy shape are returned
 * unchanged.
 */

const VPS_PHOTO_API = process.env.VPS_PHOTO_URL || 'http://72.61.197.178:8866';
const VELOCITY_PHOTO_API = process.env.VELOCITY_PHOTO_URL || 'http://100.96.203.105:8003';

const PROXY_PATH_RE = /^\/api\/activate\/photo\/([^/]+)\/([^/]+)$/;

export function resolveInternalPhotoUrl(photoUrl: string): string {
  const match = PROXY_PATH_RE.exec(photoUrl);
  if (!match) return photoUrl;

  const [, drNumber, filename] = match as unknown as [string, string, string];
  if (filename.toLowerCase().startsWith('wa_')) {
    return `${VPS_PHOTO_API}/photos/${drNumber}/${filename}`;
  }
  return `${VELOCITY_PHOTO_API}/api/photo/${drNumber}/${filename}`;
}
