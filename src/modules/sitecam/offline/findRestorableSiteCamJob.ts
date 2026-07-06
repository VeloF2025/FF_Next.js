/**
 * Warm-start page-level lookup (Task 7): when `/api/sitecam/site/:id` fails
 * (offline reload) the page doesn't yet know the job's `jobType` — that's
 * exactly what the failed fetch would have told it. Both possible per-job
 * IndexedDB stores are namespaced `SiteCamJobDB:<staffId>:<jobType>:<siteId>`
 * (Task 2 + blind-review staff-scoping fix, PR-3), so this tries each
 * `jobType` in turn (for the CURRENT staff member only) and returns whichever
 * (if either) already has durable job meta for this site — in practice at
 * most one ever will, since a given site is either an activation DR or a
 * civil pole.
 */

import { log } from '@/lib/logger';
import { SiteCamPhotoStore } from './photoStore';
import type { SiteCamJobType } from '../lib/sitecamSteps';
import type { SiteInfo } from '../lib/sitecamTypes';

const MODULE = 'findRestorableSiteCamJob';
const JOB_TYPES: readonly SiteCamJobType[] = ['activations', 'civils'];

export interface RestorableSiteCamJob {
  jobType: SiteCamJobType;
  siteInfo: SiteInfo;
}

export async function findRestorableSiteCamJob(
  staffId: string,
  siteId: string,
): Promise<RestorableSiteCamJob | null> {
  for (const jobType of JOB_TYPES) {
    try {
      const meta = await new SiteCamPhotoStore(staffId, jobType, siteId).getMeta();
      if (meta) return { jobType, siteInfo: meta.siteInfo };
    } catch (err) {
      log.warn('SiteCam job restore lookup failed', { staffId, jobType, siteId, err: String(err) }, MODULE);
    }
  }
  return null;
}
