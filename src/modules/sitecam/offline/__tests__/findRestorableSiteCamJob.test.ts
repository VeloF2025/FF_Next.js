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
    const result = await findRestorableSiteCamJob('NO-SUCH-SITE-1');
    expect(result).toBeNull();
  });

  it('finds a civils job when only the civils store has meta', async () => {
    const store = new SiteCamPhotoStore('civils', 'FRJ-RESTORE-1');
    await store.putMeta({ siteInfo: CIVIL_SITE_INFO, clientSubmissionId: 'uuid-c', submitState: 'capturing' });

    const result = await findRestorableSiteCamJob('FRJ-RESTORE-1');

    expect(result?.jobType).toBe('civils');
    expect(result?.siteInfo.siteId).toBe('FRJ-RESTORE-1');
  });

  it('finds an activations job when only the activations store has meta', async () => {
    const activationSiteInfo: SiteInfo = { ...CIVIL_SITE_INFO, jobType: 'activations', siteId: 'DR-RESTORE-2' };
    const store = new SiteCamPhotoStore('activations', 'DR-RESTORE-2');
    await store.putMeta({ siteInfo: activationSiteInfo, clientSubmissionId: 'uuid-a', submitState: 'capturing' });

    const result = await findRestorableSiteCamJob('DR-RESTORE-2');

    expect(result?.jobType).toBe('activations');
  });

  it('continues to the next job type and returns null if a lookup throws', async () => {
    vi.spyOn(SiteCamPhotoStore.prototype, 'getMeta').mockRejectedValue(new Error('IDB unavailable'));

    const result = await findRestorableSiteCamJob('WHATEVER');

    expect(result).toBeNull();
  });
});
