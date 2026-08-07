/**
 * Telling the approvers that a driver wants an address changed.
 *
 * "Approver" is not a role in this codebase — authorization is page-based
 * (design spec §9.1). It means anyone whose role holds view on
 * fleet.parking-requests, which migration 483 seeds for super_admin, admin
 * and manager.
 *
 * Known limitation, recorded deliberately: this resolves recipients from
 * role_permissions only. A user granted the page through
 * user_permission_overrides is not notified, and one revoked through an
 * override still is. Folding overrides in means per-user evaluation
 * (src/lib/permissions/index.ts works one user at a time) for a set that is
 * currently three roles wide. When the approval queue in PR 3 needs the same
 * list, the two should share one resolver — that is the point to revisit it.
 */
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { notify } from '@/modules/notifications/services/notificationBus';

const APPROVER_PERMISSION = 'fleet.parking-requests';

async function findApproverUserIds(): Promise<string[]> {
  const rows = await sql<{ id: string }>`
    SELECT u.id
    FROM users u
    JOIN role_permissions rp ON rp.role = u.role
    WHERE u.is_active = true
      AND rp.permission_key = ${APPROVER_PERMISSION}
      AND rp.actions->>'view' = 'true'
  `;
  return rows.map((r) => r.id);
}

export async function notifyParkingChangeRequested(args: {
  registration: string;
  driverName: string | null;
  declarationId: string;
}): Promise<void> {
  try {
    const recipients = await findApproverUserIds();
    if (recipients.length === 0) {
      log.warn(
        '[fleet/parking] change requested but no user holds the approval permission',
        { permission: APPROVER_PERMISSION, declarationId: args.declarationId },
        'fleet'
      );
      return;
    }

    const who = args.driverName ?? 'A driver';
    await notify({
      event_type: 'fleet.parking_change_requested',
      title: `Parking address request for ${args.registration}`,
      body: `${who} submitted an overnight parking address for ${args.registration} and is waiting for approval.`,
      action_url: '/fleet/parking/requests',
      source_module: 'fleet',
      source_id: args.declarationId,
      recipient_user_ids: recipients,
    });
  } catch (err) {
    // The declaration is already stored. A notification failure must not turn
    // a successful submission into a 500 the driver retries.
    log.error(
      '[fleet/parking] failed to notify approvers of a change request',
      { error: err, declarationId: args.declarationId },
      'fleet'
    );
  }
}
