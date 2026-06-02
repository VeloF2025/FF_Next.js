// src/lib/vfStoragePhotoUrl.ts
// Allow-list guard for photo URLs that the server will later fetch or render.
// Only VF Storage origins are trusted — this prevents a stored SSRF/XSS vector
// where an arbitrary URL persisted in the DB would be fetched server-side
// (e.g. by the VLM gallery loader) or rendered in an <img>.

const VF_STORAGE_URL = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';

/** Parse a URL, returning null instead of throwing (URL.canParse isn't available everywhere). */
function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Hosts that legitimately serve VF Storage photos. Public photo URLs use the
 * fibreflow.app domains (nginx /storage proxy); the configured storage host is
 * added so direct-origin URLs are also accepted.
 */
export const ALLOWED_PHOTO_HOSTS: ReadonlySet<string> = (() => {
  const hosts = new Set<string>(['vf.fibreflow.app', 'app.fibreflow.app', 'dev.fibreflow.app']);
  const storage = tryParseUrl(VF_STORAGE_URL);
  if (storage) hosts.add(storage.host);
  return hosts;
})();

/** True when `url` is a same-origin storage path or points at an allow-listed VF Storage host. */
export function isAllowedPhotoUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  if (url.startsWith('/storage/')) return true; // same-origin nginx proxy path
  const parsed = tryParseUrl(url);
  if (!parsed) return false;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return ALLOWED_PHOTO_HOSTS.has(parsed.host);
}
