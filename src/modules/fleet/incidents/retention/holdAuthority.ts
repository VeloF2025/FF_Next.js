/**
 * Who may act on a retention hold, and therefore who may be told about one.
 *
 * Separate from `holdRepository` on purpose: the decision belongs to
 * `userHasPermission` (override priority, expiry, and the ancestor cascade
 * that makes a child grant inert when the parent module is blocked), and that
 * function runs on the Neon HTTP driver, which the real-Postgres harness that
 * executes the repository's SQL cannot reach. The repository offers a
 * candidate superset; this narrows it.
 */
import { userHasPermission } from '@/lib/permissions';
import { FLEET_RETENTION_HOLDS_PERMISSION, listHoldAuthorityCandidates } from './holdRepository';

/** Active users who may create/review/release holds. An empty result is a real condition — see `retentionNotifications`, which refuses to page anyone rather than falling back to a wider audience. */
export async function resolveHoldAuthorityRecipients(): Promise<string[]> {
  const candidates = await listHoldAuthorityCandidates();
  const allowed: string[] = [];
  for (const candidateId of candidates) {
    if (await userHasPermission(candidateId, FLEET_RETENTION_HOLDS_PERMISSION, 'edit')) allowed.push(candidateId);
  }
  return allowed;
}
