import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findRestorableSiteCamJob } from '../findRestorableSiteCamJob';
import { SiteCamPhotoStore } from '../photoStore';
import type { SiteInfo } from '../../hooks/useSiteCamCapture';

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const STAFF_A = 'staff-a';
const STAFF_B = 'staff-b';

const CIVIL_SITE_INFO: SiteInfo = {
  jobType: 'civils',
  siteId: 'FRJ-RESTORE-1',
  customerName: null,
  address: null,
  projectName: null,
  plannedLat: -26.1,
  plannedLon: 27.9,
  pon: null,
  zone: null,
};

describe('findRestorableSiteCamJob', () => {
  it('returns null when neither job type has a stored job for this site', async () => {
    const result = await findRestorableSiteCamJob(STAFF_A, 'NO-SUCH-SITE-1');
    expect(result).toBeNull();
  });

  it('finds a civils job when only the civils store has meta', async () => {
    const store = new SiteCamPhotoStore(STAFF_A, 'civils', 'FRJ-RESTORE-1');
    await store.putMeta({ siteInfo: CIVIL_SITE_INFO, clientSubmissionId: 'uuid-c', submitState: 'capturing' });

    const result = await findRestorableSiteCamJob(STAFF_A, 'FRJ-RESTORE-1');

    expect(result?.jobType).toBe('civils');
    expect(result?.siteInfo.siteId).toBe('FRJ-RESTORE-1');
  });

  it('finds an activations job when only the activations store has meta', async () => {
    const activationSiteInfo: SiteInfo = { ...CIVIL_SITE_INFO, jobType: 'activations', siteId: 'DR-RESTORE-2' };
    const store = new SiteCamPhotoStore(STAFF_A, 'activations', 'DR-RESTORE-2');
    await store.putMeta({ siteInfo: activationSiteInfo, clientSubmissionId: 'uuid-a', submitState: 'capturing' });

    const result = await findRestorableSiteCamJob(STAFF_A, 'DR-RESTORE-2');

    expect(result?.jobType).toBe('activations');
  });

  it('continues to the next job type and returns null if a lookup throws', async () => {
    vi.spyOn(SiteCamPhotoStore.prototype, 'getMeta').mockRejectedValue(new Error('IDB unavailable'));

    const result = await findRestorableSiteCamJob(STAFF_A, 'WHATEVER');

    expect(result).toBeNull();
  });

  it('continues to the second job type when the first rejects, and finds real meta there', async () => {
    // JOB_TYPES checks 'activations' first, then 'civils'. Seed only 'civils'
    // with real meta, and make the FIRST lookup ('activations') reject once —
    // `mockRejectedValueOnce` falls through to the real implementation on
    // every call after, so the 'civils' lookup genuinely hits IndexedDB.
    const civilSiteInfo: SiteInfo = { ...CIVIL_SITE_INFO, siteId: 'MIXED-1' };
    const civilStore = new SiteCamPhotoStore(STAFF_A, 'civils', 'MIXED-1');
    await civilStore.putMeta({ siteInfo: civilSiteInfo, clientSubmissionId: 'uuid-mixed', submitState: 'capturing' });

    vi.spyOn(SiteCamPhotoStore.prototype, 'getMeta').mockRejectedValueOnce(
      new Error('activations lookup unavailable'),
    );

    const result = await findRestorableSiteCamJob(STAFF_A, 'MIXED-1');

    expect(result?.jobType).toBe('civils');
    expect(result?.siteInfo.siteId).toBe('MIXED-1');
  });

  it('isolates stores per staff — one staff cannot read another staff\'s job at the same site', async () => {
    const store = new SiteCamPhotoStore(STAFF_A, 'civils', 'SHARED-DEVICE-1');
    await store.putMeta({
      siteInfo: { ...CIVIL_SITE_INFO, siteId: 'SHARED-DEVICE-1' },
      clientSubmissionId: 'uuid-staff-a',
      submitState: 'queued',
    });

    const resultForOwner = await findRestorableSiteCamJob(STAFF_A, 'SHARED-DEVICE-1');
    const resultForOtherStaff = await findRestorableSiteCamJob(STAFF_B, 'SHARED-DEVICE-1');

    expect(resultForOwner?.siteInfo.siteId).toBe('SHARED-DEVICE-1');
    expect(resultForOtherStaff).toBeNull();
  });
});
