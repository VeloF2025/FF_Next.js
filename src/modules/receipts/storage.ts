/**
 * VF Storage URL helpers for the receipts module.
 *
 * Files in staff_receipts.image_url are stored as relative
 * `/storage/staff/<staffId>/receipts/<uuid>.<ext>` paths so the value is
 * environment-agnostic. Server-side fetches need the internal URL
 * (port 8091, bypassing nginx). Mirrors src/modules/payslips/storage.ts.
 */

const VF_STORAGE_INTERNAL_URL =
  process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

export function resolveReceiptFetchUrl(stored: string): string {
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
      // Fall through.
    }
    return stored;
  }
  return `${VF_STORAGE_INTERNAL_URL}/${stored.replace(/^\/+/, '')}`;
}
