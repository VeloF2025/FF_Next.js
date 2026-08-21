/**
 * staffSite — which site a person belongs to, and whether they should appear in
 * the "issue stock to" picker for a given store.
 *
 * Two sources, in precedence order:
 *   1. assigned_project_id — set by an admin. Casuals do not move between
 *      sites, so this is the durable answer.
 *   2. declared_project_id — what the worker picked at login (migration 513).
 *      Covers everyone not yet assigned, which is most people while the
 *      assignment data is still being filled in.
 *
 * The store side comes from stock_locations.project_id. A store with no project
 * is UNMAPPED, and an unmapped store must show everyone rather than filter to a
 * site it cannot determine — hiding names on a store we know nothing about
 * would silently make stock un-issuable.
 */

/** Where a person's site came from. Surfaced so the UI can be honest about it. */
export type SiteSource = 'assigned' | 'declared' | 'none';

export interface StaffSiteFields {
  assignedProjectId: string | null;
  assignedProjectName?: string | null;
  declaredProjectId: string | null;
  declaredProjectName?: string | null;
}

export interface ResolvedSite {
  projectId: string | null;
  projectName: string | null;
  source: SiteSource;
}

/**
 * The person's effective site. Admin assignment wins; declaration is the
 * fallback; neither means we do not know.
 */
export function resolveStaffSite(fields: StaffSiteFields): ResolvedSite {
  if (fields.assignedProjectId) {
    return {
      projectId: fields.assignedProjectId,
      projectName: fields.assignedProjectName ?? null,
      source: 'assigned',
    };
  }
  if (fields.declaredProjectId) {
    return {
      projectId: fields.declaredProjectId,
      projectName: fields.declaredProjectName ?? null,
      source: 'declared',
    };
  }
  return { projectId: null, projectName: null, source: 'none' };
}

/** Why a person is (or is not) shown for a given store. */
export type SiteMatch =
  | 'match'            // their site is the store's site
  | 'elsewhere'        // their site is a DIFFERENT site — hide by default
  | 'unknown-staff'    // we do not know their site — show, do not punish missing data
  | 'unmapped-store';  // the store has no site — show everyone

/**
 * Should this person appear for this store, and why.
 *
 * Only 'elsewhere' is hidden by default. Both unknown cases show, because the
 * cost of hiding someone wrongly is a handout that cannot happen, while the
 * cost of showing someone extra is one wrong tap that the flow already flags.
 */
export function matchStaffToStore(
  staffSite: ResolvedSite,
  storeProjectId: string | null,
): SiteMatch {
  if (!storeProjectId) return 'unmapped-store';
  if (!staffSite.projectId) return 'unknown-staff';
  return staffSite.projectId === storeProjectId ? 'match' : 'elsewhere';
}

/** The default picker list: everyone except people known to work elsewhere. */
export function isVisibleByDefault(match: SiteMatch): boolean {
  return match !== 'elsewhere';
}
