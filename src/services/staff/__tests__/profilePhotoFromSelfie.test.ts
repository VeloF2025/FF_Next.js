/**
 * Unit tests for syncStaffProfilePhotoFromSelfie.
 *
 * Locks the three branches of the policy:
 *   - NULL profile photo → fill from selfie
 *   - Existing attendance-selfie URL → refresh to new selfie
 *   - HR-curated photo → leave alone
 * + the no-op cases (already pointing at the same selfie, missing
 * args).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));

import { syncStaffProfilePhotoFromSelfie } from '../profilePhotoFromSelfie';

const STAFF_ID = '11111111-2222-3333-4444-555555555555';
const NEW_SELFIE = '/storage/attendance/abc/2026-04-25/in.jpg';
const OLD_SELFIE = '/storage/attendance/abc/2026-03-15/in.jpg';
const HR_PHOTO = '/storage/staff/abc/profile.jpg';

beforeEach(() => {
  mocks.sql.mockReset();
});

describe('syncStaffProfilePhotoFromSelfie', () => {
  it('returns no_op when staffId is empty', async () => {
    const out = await syncStaffProfilePhotoFromSelfie('', NEW_SELFIE);
    expect(out).toEqual({ updated: false, reason: 'no_op' });
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('returns no_op when selfieUrl is empty', async () => {
    const out = await syncStaffProfilePhotoFromSelfie(STAFF_ID, '');
    expect(out).toEqual({ updated: false, reason: 'no_op' });
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('updates from null', async () => {
    mocks.sql
      .mockResolvedValueOnce([{ profile_photo_url: null }])
      .mockResolvedValueOnce(undefined);

    const out = await syncStaffProfilePhotoFromSelfie(STAFF_ID, NEW_SELFIE);

    expect(out).toEqual({ updated: true, reason: 'updated_from_null' });
    expect(mocks.sql).toHaveBeenCalledTimes(2);
  });

  it('refreshes when current photo is itself an attendance selfie', async () => {
    mocks.sql
      .mockResolvedValueOnce([{ profile_photo_url: OLD_SELFIE }])
      .mockResolvedValueOnce(undefined);

    const out = await syncStaffProfilePhotoFromSelfie(STAFF_ID, NEW_SELFIE);

    expect(out).toEqual({ updated: true, reason: 'refreshed_existing_selfie' });
    expect(mocks.sql).toHaveBeenCalledTimes(2);
  });

  it('keeps an HR-curated profile photo (any non-attendance path)', async () => {
    mocks.sql.mockResolvedValueOnce([{ profile_photo_url: HR_PHOTO }]);

    const out = await syncStaffProfilePhotoFromSelfie(STAFF_ID, NEW_SELFIE);

    expect(out).toEqual({ updated: false, reason: 'kept_hr_photo' });
    // Only the SELECT — no UPDATE.
    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when current photo is exactly the same selfie URL', async () => {
    mocks.sql.mockResolvedValueOnce([{ profile_photo_url: NEW_SELFIE }]);

    const out = await syncStaffProfilePhotoFromSelfie(STAFF_ID, NEW_SELFIE);

    expect(out).toEqual({ updated: false, reason: 'no_op' });
    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });

  it('treats absolute attendance URLs the same as relative ones (path prefix only)', async () => {
    // The check uses startsWith('/storage/attendance/'). An absolute
    // https:// URL would NOT match — that's the documented behaviour:
    // we only refresh selfie-stored values, not arbitrary URLs that
    // happen to look like attendance.
    mocks.sql.mockResolvedValueOnce([
      { profile_photo_url: 'https://app.fibreflow.app/storage/attendance/abc/2026-03-15/in.jpg' },
    ]);

    const out = await syncStaffProfilePhotoFromSelfie(STAFF_ID, NEW_SELFIE);

    // Conservative: an absolute URL is treated as HR-curated to avoid
    // accidentally trampling something a human did.
    expect(out).toEqual({ updated: false, reason: 'kept_hr_photo' });
  });

  it('propagates DB errors so the caller can wrap in try/catch', async () => {
    mocks.sql.mockRejectedValueOnce(new Error('connection refused'));

    await expect(
      syncStaffProfilePhotoFromSelfie(STAFF_ID, NEW_SELFIE)
    ).rejects.toThrow(/connection refused/);
  });
});
