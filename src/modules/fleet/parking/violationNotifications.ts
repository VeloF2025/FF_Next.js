import { log } from '@/lib/logger';
import { notify } from '@/modules/notifications/services/notificationBus';
import { fleetAlertUserIds } from './alertRecipients';
import type { ParkingCheckReport } from './types';

export async function notifyNewParkingViolations(
  report: ParkingCheckReport
): Promise<{ warnings: number; notifiedViolations: number }> {
  const violations = report.results.filter((result) => result.newViolation);
  const recipients = fleetAlertUserIds(process.env.FLEET_ALERT_USER_IDS);
  if (violations.length === 0) return { warnings: 0, notifiedViolations: 0 };
  if (recipients.length === 0) {
    log.warn('New parking violations have no configured recipients', { count: violations.length }, 'fleet');
    return { warnings: violations.length, notifiedViolations: 0 };
  }

  let warnings = 0;
  let notifiedViolations = 0;
  for (const violation of violations) {
    try {
      const result = await notify({
        event_type: 'fleet.parking_violation',
        title: `Parking violation for ${violation.registration}`,
        body: violation.distanceM === null
          ? `${violation.registration} was outside its declared overnight parking area.`
          : `${violation.registration} was ${Math.round(violation.distanceM)} m from its declared overnight parking area.`,
        action_url: `/fleet/parking?date=${report.checkDate}&result=violation`,
        source_module: 'fleet',
        source_id: `${violation.vehicleId}:${report.checkDate}`,
        idempotency_key: `parking-violation:${violation.vehicleId}:${report.checkDate}`,
        recipient_user_ids: recipients,
        metadata: { registration: violation.registration, distanceM: violation.distanceM === null ? null : Math.round(violation.distanceM) },
      });
      warnings += result.failed_recipients;
      if (result.accepted_recipients > 0) notifiedViolations += 1;
    } catch (error) {
      warnings += 1;
      log.error('Parking violation notification failed', {
        vehicleId: violation.vehicleId,
        error: error instanceof Error ? error.message : String(error),
      }, 'fleet');
    }
  }
  return { warnings, notifiedViolations };
}
