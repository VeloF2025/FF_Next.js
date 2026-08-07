/**
 * Telling the approvers that a driver wants an address changed.
 *
 * The recipient lookup itself lives in parkingApprovers.ts — see the note
 * there on why it is kept out of this file's import closure.
 */
import { log } from '@/lib/logger';
import { notify } from '@/modules/notifications/services/notificationBus';
import { APPROVER_PERMISSION, findApproverUserIds } from './parkingApprovers';

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
