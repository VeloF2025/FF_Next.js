/**
 * Allowlist guard for URLs the civil-gallery photo proxy will fetch with a
 * Microsoft Graph OAuth Bearer token attached.
 *
 * Civil QA gallery photos are stored as Microsoft Graph API URLs
 * (`https://graph.microsoft.com/v1.0/drives/...`). The proxy attaches the
 * app's Graph access token when fetching them, so we must never forward that
 * token to any other origin — doing so would leak the credential (SSRF). Only
 * the canonical Graph host over HTTPS is permitted.
 */
export function isGraphPhotoUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && parsed.hostname === 'graph.microsoft.com';
}
