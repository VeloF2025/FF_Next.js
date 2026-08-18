/**
 * PM plus active oversight recipient resolution for Fleet operational
 * incident notifications (design §7).
 *
 * Recipients for one incident are: the active project manager resolved from
 * `projects.project_manager` (when the incident has a project) plus active
 * Fleet oversight members (`settingsRepository.listOversightMembers`), then
 * deduplicated and filtered to active FibreFlow accounts. A projectless
 * incident goes to oversight only — there is no manager row to add.
 *
 * This is the ONE recipient-resolution path for PR6 notifications. It
 * supersedes the interim project-manager-only lookup `monitorService`
 * carried while this module did not exist yet (see that module's history).
 *
 * An empty result is deliberately not an error thrown here — it is data the
 * caller must record as a failure (design §7: "An empty recipient set is
 * recorded as a notification failure ... it does not roll back the
 * incident"). Throwing would make that recording the exception path instead
 * of the normal one for every call site.
 */
import { query } from '@/lib/db-pool';
import { listOversightMembers } from './settingsRepository';

export interface ResolvedIncidentRecipients {
  userIds: string[];
  /** True when no recipient could be resolved — callers must record this as a failure, never treat it as a silent success. */
  failed: boolean;
}

interface ProjectManagerRow extends Record<string, unknown> { project_manager: string | null }
interface ActiveUserRow extends Record<string, unknown> { id: string }

async function loadProjectManagerId(projectId: string): Promise<string | null> {
  const rows = await query<ProjectManagerRow>(
    `/* fleet-incident-recipients:project-manager */ SELECT project_manager FROM projects WHERE id = $1::uuid LIMIT 1`,
    [projectId],
  );
  return rows[0]?.project_manager ?? null;
}

async function filterToActiveUserIds(userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await query<ActiveUserRow>(
    `/* fleet-incident-recipients:active-filter */ SELECT id FROM users WHERE id = ANY($1::uuid[]) AND is_active = true`,
    [userIds],
  );
  return rows.map((row) => row.id);
}

/**
 * Resolves the recipients for one incident/notification. `projectId` is the
 * incident's own project (null for a projectless incident or for a
 * project-agnostic notification such as morning-summary's "unassigned"
 * bucket or monitor-health alerts, which always pass null).
 */
export async function resolveIncidentRecipients(projectId: string | null): Promise<ResolvedIncidentRecipients> {
  const oversight = await listOversightMembers({ activeOnly: true });
  const candidateIds = new Set<string>(oversight.map((member) => member.userId));

  if (projectId) {
    const pmUserId = await loadProjectManagerId(projectId);
    if (pmUserId) candidateIds.add(pmUserId);
  }

  const userIds = await filterToActiveUserIds([...candidateIds]);
  return { userIds, failed: userIds.length === 0 };
}
