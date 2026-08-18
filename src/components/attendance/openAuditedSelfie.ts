/**
 * Open an attendance selfie through the audited route.
 *
 * `/api/staff/attendance-selfie` returns a JSON envelope, not the image and
 * not a redirect — it checks `people.staff.attendance.manage`, narrows to the
 * viewer's supervisor scope, and writes the POPIA access-log row BEFORE it
 * reveals the storage URL. So a plain `<a href>` to it opens a tab of raw
 * JSON, not a photo. Every caller must fetch, unwrap, then open.
 *
 * Extracted from `TimeAttendanceTab` so the Pulse check-in-locations report
 * shares one implementation. The two `reason` codes below are contractual —
 * the route returns them in `error.details.reason` and each needs its own
 * message, because "audit write failed" and "photo was never captured" call
 * for completely different follow-up from whoever is looking.
 */

import { log } from '@/lib/logger';

interface ApiFailure {
  success?: false;
  error?: { message?: string; details?: { reason?: string } };
}

function extractErrorMessage(body: unknown, fallback: string): string {
  const err = (body as ApiFailure | undefined)?.error;
  return (typeof err?.message === 'string' && err.message) || fallback;
}

export async function openAuditedSelfie(
  entryId: string,
  kind: 'in' | 'out',
  context: string,
  onError: (message: string) => void,
): Promise<void> {
  try {
    const res = await fetch(
      `/api/staff/attendance-selfie?entryId=${encodeURIComponent(entryId)}` +
        `&kind=${kind}&context=${encodeURIComponent(context)}`,
      { credentials: 'include' },
    );
    const body = (await res.json().catch(() => null)) as ApiFailure | { success: true; data?: { url?: string } } | null;
    if (!res.ok || !body || body.success !== true) {
      const reason = (body as ApiFailure | null)?.error?.details?.reason;
      if (reason === 'audit_write_failed') {
        onError('Compliance audit failed — selfie access denied. Please try again.');
        return;
      }
      if (reason === 'unavailable') {
        onError('Selfie unavailable (never captured or deleted under retention policy).');
        return;
      }
      onError(extractErrorMessage(body, 'Could not load the selfie.'));
      return;
    }
    const url = body.data?.url;
    if (!url) {
      onError('Server returned an empty selfie URL.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (err) {
    log.error('openAuditedSelfie: fetch failed', err instanceof Error ? { message: err.message } : { err });
    onError('Network error — could not load the selfie.');
  }
}

/**
 * Pull the entryId + kind back out of an audited selfie path emitted by a
 * report row. Returns null for anything that isn't one, so a malformed or
 * empty cell renders as a dash instead of a dead button.
 */
export function parseSelfieHref(href: string): { entryId: string; kind: 'in' | 'out' } | null {
  const match = /entryId=([0-9a-fA-F-]{36})&kind=(in|out)\b/.exec(href);
  if (!match) return null;
  return { entryId: match[1]!, kind: match[2] as 'in' | 'out' };
}
