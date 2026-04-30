/**
 * Best-effort: keep `staff.profile_photo_url` in sync with the latest
 * clock-in selfie.
 *
 * Hein's brief: "if there's no profile photo of the employee... use
 * the selfie to upload their profile photo. And then we've got an
 * updated photo of each individual as well."
 *
 * Behaviour:
 *   - If staff.profile_photo_url is NULL → set it to the selfie URL.
 *   - If staff.profile_photo_url is itself a previous selfie URL
 *     (path begins with `/storage/attendance/`) → refresh it to the
 *     newest selfie. This gives "an updated photo of each individual"
 *     as their face changes month over month.
 *   - If staff.profile_photo_url points at an HR-curated photo (any
 *     other path), leave it alone. HR's hand-picked headshots win.
 *
 * Failure is non-fatal — the caller (clock-in handler) MUST treat any
 * exception as a log-and-continue: the clock event itself is the
 * critical write, profile-photo refresh is a side benefit.
 *
 * Privacy note: the same selfie that's already in attendance is now
 * also the profile photo. This is the SAME storage object — no new
 * upload, no new copy. POPIA-wise the data is being processed for
 * the same purpose (identification of the staff member); we're just
 * widening the consumers from "attendance review" to "anywhere the
 * staff card is rendered". The audit trail in
 * `attendance_selfie_access_log` is unchanged because the photo is
 * fetched via the same VF-Storage path; no NEW access path is
 * introduced.
 */

import { sql } from '@/lib/db-pool';

const ATTENDANCE_SELFIE_PREFIX = '/storage/attendance/';

export interface SyncResult {
  updated: boolean;
  reason: 'updated_from_null' | 'refreshed_existing_selfie' | 'kept_hr_photo' | 'no_op';
}

/**
 * Sync the staff member's profile_photo_url with their latest clock-in
 * selfie according to the rules above. Returns a result describing
 * what happened, primarily for tests + observability — production
 * callers usually ignore the return value.
 *
 * Throws only on programming errors (e.g. invalid args). Database /
 * network errors are propagated so the caller can decide whether to
 * swallow them; the recommendation is to wrap in try/catch + log.
 */
export async function syncStaffProfilePhotoFromSelfie(
  staffId: string,
  selfieUrl: string
): Promise<SyncResult> {
  if (!staffId || !selfieUrl) {
    return { updated: false, reason: 'no_op' };
  }

  const rows = await sql<{ profile_photo_url: string | null }>`
    SELECT profile_photo_url
    FROM staff
    WHERE id = ${staffId}
    LIMIT 1
  `;
  const current = rows[0]?.profile_photo_url ?? null;

  if (current === selfieUrl) {
    // Already pointing at this exact selfie (e.g. handler retry,
    // duplicate clock-in attempt).
    return { updated: false, reason: 'no_op' };
  }

  if (current === null) {
    await writeProfilePhotoUrl(staffId, selfieUrl);
    return { updated: true, reason: 'updated_from_null' };
  }

  if (current.startsWith(ATTENDANCE_SELFIE_PREFIX)) {
    await writeProfilePhotoUrl(staffId, selfieUrl);
    return { updated: true, reason: 'refreshed_existing_selfie' };
  }

  // HR-curated photo (any non-attendance storage path) — keep.
  return { updated: false, reason: 'kept_hr_photo' };
}

async function writeProfilePhotoUrl(staffId: string, url: string): Promise<void> {
  await sql`
    UPDATE staff
    SET profile_photo_url = ${url},
        updated_at = NOW()
    WHERE id = ${staffId}
  `;
}

export const _internal = { ATTENDANCE_SELFIE_PREFIX };
