/**
 * Supervisor-scope helper for attendance workflows.
 *
 * Answers "can viewer V act as supervisor for target T?" — shared by
 * corrections-review, manual-entry, weekly-locks, and cartrack-mapping
 * so the policy stays in one place. The caller still owns RBAC:
 * super_admin / people.staff.admin permissions short-circuit above
 * this helper; we only judge the per-staff scope gate.
 *
 * Scope rule (union — any branch grants access):
 *   1. V === T            — a staff member can always act on their own data
 *   2. reports_to chain   — V is an ancestor of T, walked up to MAX_DEPTH
 *                           hops. Bounded to prevent cycles corrupting the
 *                           query into an unbounded recursion.
 *   3. department manager — V.department === T.department (non-null) AND
 *                           V has at least one direct report (another
 *                           staff's reports_to points at V). This is the
 *                           fallback when T.reports_to is null or broken
 *                           mid-chain, which today covers 49/75 active
 *                           staff until the Odoo backfill + future
 *                           NOT NULL migration lands.
 *
 * Design notes:
 *   - Pure SQL in a single query — no N+1, one round-trip per call.
 *   - Bounded recursion via depth < MAX_DEPTH in the CTE.
 *   - NULL-safe: a null department on either side short-circuits the
 *     department-manager branch (department IS NULL would otherwise
 *     match ANY null-dept viewer, dangerously widening scope).
 *   - `viewerStaffId === targetStaffId` is allowed; the caller may want
 *     to use this for self-review (uncommon) or for "is this my own
 *     correction?" UI gating. Permission layer can still deny above.
 */

import { sql } from '@/lib/db-pool';
import { getStaffIdForUser } from '@/services/staff/staffAccessService';
import type { AuthUser } from '@/lib/auth/types';

/**
 * Cap on reports_to chain walking. 10 levels comfortably exceeds any
 * plausible org structure (Hein → director → manager → lead → staff is
 * 5) while keeping the recursive CTE bounded.
 */
const MAX_REPORTS_TO_DEPTH = 10;

export async function canSuperviseStaff(
  viewerStaffId: string,
  targetStaffId: string
): Promise<boolean> {
  if (!viewerStaffId || !targetStaffId) return false;
  if (viewerStaffId === targetStaffId) return true;

  const rows = await sql<{ allowed: boolean }>`
    WITH RECURSIVE ancestors AS (
      -- Seed: the target's direct manager.
      SELECT reports_to AS ancestor_id, 1 AS depth
      FROM staff
      WHERE id = ${targetStaffId}

      UNION ALL

      -- Walk up the chain until we run out of reports_to or hit the cap.
      SELECT s.reports_to, a.depth + 1
      FROM staff s
      JOIN ancestors a ON s.id = a.ancestor_id
      WHERE a.ancestor_id IS NOT NULL
        AND a.depth < ${MAX_REPORTS_TO_DEPTH}
    )
    SELECT (
      -- Branch 2: viewer is an ancestor in the reports_to chain.
      EXISTS (
        SELECT 1 FROM ancestors WHERE ancestor_id = ${viewerStaffId}
      )
      -- Branch 3: viewer shares T.department AND has direct reports.
      -- A manager needs someone reporting to them; pure department
      -- co-membership without downstream reports is NOT supervision.
      OR EXISTS (
        SELECT 1
        FROM staff v, staff t
        WHERE v.id = ${viewerStaffId}
          AND t.id = ${targetStaffId}
          AND v.department IS NOT NULL
          AND t.department IS NOT NULL
          AND v.department = t.department
          AND EXISTS (
            SELECT 1 FROM staff r WHERE r.reports_to = v.id
          )
      )
    ) AS allowed
  `;
  return rows[0]?.allowed ?? false;
}

/**
 * Auth-aware wrapper for API handlers. Combines the super-admin bypass,
 * the user→staff_id lookup, and the scope check into a single call so
 * each caller doesn't reimplement the dance.
 *
 * Returns:
 *   - `true`  — user is authorized; proceed with the action.
 *   - `false` — scope violation; caller issues a 403.
 *
 * Super-admin / admin roles always return true (RBAC dominant). Users
 * without a linked staff record return false — the attendance module
 * is staff-facing and a bare admin user without staff linkage has no
 * "supervisor" relationship to judge.
 */
export async function authorizedToSuperviseStaff(
  user: AuthUser,
  targetStaffId: string
): Promise<boolean> {
  if (!targetStaffId) return false;
  if (user.role === 'super_admin' || user.role === 'admin') return true;
  const viewerStaffId = await getStaffIdForUser(user.id);
  if (!viewerStaffId) return false;
  return canSuperviseStaff(viewerStaffId, targetStaffId);
}

/**
 * Inverse of `canSuperviseStaff`: returns the full set of staff_ids the
 * viewer can supervise. Used by list-scoped APIs (e.g. corrections
 * review queue) to filter at the SQL layer instead of fetching the
 * full list and filtering row-by-row.
 *
 * The set includes:
 *   - the viewer themselves (self-view)
 *   - every descendant via reports_to chain (bounded depth)
 *   - every staff in the viewer's department IFF the viewer has at
 *     least one direct report (mirrors the department-manager branch
 *     in canSuperviseStaff)
 *
 * Returns an empty array when the viewer has no subordinates and no
 * qualifying department members — callers should treat that as "nothing
 * to show" rather than failing.
 */
export async function staffIdsSupervisedBy(
  viewerStaffId: string
): Promise<string[]> {
  if (!viewerStaffId) return [];
  const rows = await sql<{ id: string }>`
    WITH RECURSIVE descendants AS (
      -- Direct reports.
      SELECT id, 1 AS depth
      FROM staff
      WHERE reports_to = ${viewerStaffId}

      UNION ALL

      -- Transitive reports, bounded to MAX_REPORTS_TO_DEPTH levels.
      SELECT s.id, d.depth + 1
      FROM staff s
      JOIN descendants d ON s.reports_to = d.id
      WHERE d.depth < ${MAX_REPORTS_TO_DEPTH}
    ),
    viewer AS (
      SELECT id, department
      FROM staff
      WHERE id = ${viewerStaffId}
    ),
    viewer_has_reports AS (
      SELECT EXISTS (
        SELECT 1 FROM staff WHERE reports_to = ${viewerStaffId}
      ) AS yes
    )
    -- Self
    SELECT id FROM viewer
    UNION
    -- Descendants via reports_to chain
    SELECT id FROM descendants
    UNION
    -- Same-department fallback (only when viewer has direct reports)
    SELECT s.id
    FROM staff s, viewer v, viewer_has_reports vhr
    WHERE vhr.yes
      AND v.department IS NOT NULL
      AND s.department IS NOT NULL
      AND s.department = v.department
  `;
  return rows.map((r) => r.id);
}
