/**
 * VF Storage URL helpers for the receipts module.
 *
 * Files in staff_receipts.image_url are stored as relative
 * `/storage/staff/<staffId>/receipts/<uuid>.<ext>` paths so the value is
 * environment-agnostic. Server-side fetches need the internal URL
 * (port 8091, bypassing nginx). Mirrors src/modules/payslips/storage.ts.
 *
 * SECURITY: image_url is supplied by the client at upload time and is then
 * fetched server-side by both the proxy endpoints and the email pipeline.
 * Untrusted external URLs MUST be rejected to avoid SSRF (e.g. a poisoned
 * image_url pointing at 169.254.169.254 or http://localhost:5437) and to
 * prevent the email job from exfiltrating internal-network bytes to the
 * accounting inbox. Only paths into VF Storage are accepted; anything else
 * throws.
 */

const VF_STORAGE_INTERNAL_URL =
  process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

export class InvalidReceiptUrlError extends Error {
  constructor(stored: string) {
    super(`Refusing to fetch receipt URL: ${stored.slice(0, 100)}`);
    this.name = 'InvalidReceiptUrlError';
  }
}

export function resolveReceiptFetchUrl(stored: string): string {
  if (typeof stored !== 'string' || stored.length === 0) {
    throw new InvalidReceiptUrlError(String(stored));
  }
  // 1. Already an internal storage URL — pass through.
  if (stored.startsWith(VF_STORAGE_INTERNAL_URL)) {
    return stored;
  }
  // 2. Relative `/storage/...` path — prefix with internal storage host.
  if (stored.startsWith('/storage/')) {
    return `${VF_STORAGE_INTERNAL_URL}${stored.replace(/^\/storage/, '')}`;
  }
  // 3. Absolute URL — only accept *.fibreflow.app /storage/ links.
  //    Any other host (including 127.0.0.1, link-local AWS metadata,
  //    or arbitrary external sites) is rejected.
  if (stored.startsWith('http://') || stored.startsWith('https://')) {
    let parsed: URL;
    try {
      parsed = new URL(stored);
    } catch {
      throw new InvalidReceiptUrlError(stored);
    }
    if (
      (parsed.hostname === 'fibreflow.app' || parsed.hostname.endsWith('.fibreflow.app')) &&
      parsed.pathname.startsWith('/storage/')
    ) {
      return `${VF_STORAGE_INTERNAL_URL}${parsed.pathname.replace(/^\/storage/, '')}`;
    }
    throw new InvalidReceiptUrlError(stored);
  }
  // 4. Bare relative path (no leading slash, no scheme) — treat as a key
  //    inside VF Storage. Reject anything that escapes the storage root.
  if (stored.includes('..') || stored.includes('://') || stored.startsWith('//')) {
    throw new InvalidReceiptUrlError(stored);
  }
  return `${VF_STORAGE_INTERNAL_URL}/${stored.replace(/^\/+/, '')}`;
}
