/**
 * VF Storage URL helpers for the payslips module.
 *
 * Files in payslips.pdf_url are stored as relative `/storage/staff/payslips/...`
 * paths so the value is environment-agnostic (dev + prod share the storage
 * backend). Server-side fetches need an absolute URL; the storage server is
 * reachable internally on port 8091 (see VF_STORAGE_INTERNAL_URL pattern
 * already in use by ocrTempStorageService.ts).
 */

const VF_STORAGE_INTERNAL_URL =
  process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

/**
 * Resolve a stored payslip URL (relative or already-absolute) to the
 * internal absolute URL the Next.js server can fetch directly.
 */
export function resolvePayslipFetchUrl(stored: string): string {
  if (stored.startsWith(VF_STORAGE_INTERNAL_URL)) {
    return stored;
  }
  if (stored.startsWith('/storage/')) {
    return `${VF_STORAGE_INTERNAL_URL}${stored.replace(/^\/storage/, '')}`;
  }
  if (stored.startsWith('http://') || stored.startsWith('https://')) {
    try {
      const url = new URL(stored);
      if (url.hostname.endsWith('fibreflow.app')) {
        return `${VF_STORAGE_INTERNAL_URL}${url.pathname.replace(/^\/storage/, '')}`;
      }
    } catch {
      // Fall through to return as-is.
    }
    return stored;
  }
  // Bare path like "staff/payslips/abc.pdf" — assume already-internal-relative.
  return `${VF_STORAGE_INTERNAL_URL}/${stored.replace(/^\/+/, '')}`;
}
