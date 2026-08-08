/**
 * Telling a driver what happened to their parking request.
 *
 * Spec §10 marks this a deliberate exception to "no automatic contact with
 * drivers" — that rule was set for violations. Someone who submits a request
 * has to learn the outcome or the workflow stalls at their end.
 *
 * In-app AND email, per the event's registered channel defaults. Email was
 * added deliberately: a decline carries disciplinary weight, and in-app alone
 * means the affected driver finds out whenever they next happen to open /my.
 */
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { notify } from '@/modules/notifications/services/notificationBus';
import type { DecisionOutcome } from './types';

export async function notifyParkingChangeDecided(args: {
  driverStaffId: string;
  registration: string;
  outcome: DecisionOutcome;
  decisionNote: string | null;
  requestId: string;
}): Promise<void> {
  try {
    // The bus addresses users; the driver is staff. staff.user_id is nullable
    // and is null for most field staff, so this legitimately finds nobody.
    const rows = await sql<{ user_id: string | null }>`
      SELECT user_id FROM staff WHERE id = ${args.driverStaffId} LIMIT 1
    `;
    const userId = rows[0]?.user_id ?? null;
    if (!userId) {
      log.info(
        '[fleet/parking] decision made but the driver has no linked user account to notify',
        { staffId: args.driverStaffId, requestId: args.requestId },
        'fleet'
      );
      return;
    }

    const approved = args.outcome === 'approved';
    const note = args.decisionNote ? ` Note: ${args.decisionNote}` : '';
    await notify({
      event_type: 'fleet.parking_change_decided',
      title: approved
        ? `Parking address approved for ${args.registration}`
        : `Parking address declined for ${args.registration}`,
      body: approved
        ? `Your overnight parking address for ${args.registration} is now in effect.${note}`
        : `Your overnight parking address request for ${args.registration} was declined.${note}`,
      action_url: '/my/vehicle/parking',
      source_module: 'fleet',
      source_id: args.requestId,
      recipient_user_ids: [userId],
    });
  } catch (err) {
    // The decision is already committed. A notification failure must not turn
    // a completed approval into a 500 the approver retries.
    log.error(
      '[fleet/parking] failed to notify the driver of a decision',
      { error: err, requestId: args.requestId },
      'fleet'
    );
  }
}
