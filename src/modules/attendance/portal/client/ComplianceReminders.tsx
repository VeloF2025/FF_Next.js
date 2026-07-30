import { Car, ShieldCheck } from 'lucide-react';

export type VehicleCheckDue = 'daily' | 'weekly';
export type CheckNoticeStatus = 'due' | 'unavailable' | null;
export type VehicleCheckNoticeStatus = VehicleCheckDue | 'unavailable' | null;

interface ComplianceRemindersProps {
  hsStatus: CheckNoticeStatus;
  vehicleCheckStatus: VehicleCheckNoticeStatus;
  vehicleRegistration: string | null;
  vehiclePending: boolean;
  onHsCheckin: () => void;
  onVehicleCheck: (checkType?: VehicleCheckDue) => void;
}

export function ComplianceReminders({
  hsStatus,
  vehicleCheckStatus,
  vehicleRegistration,
  vehiclePending,
  onHsCheckin,
  onVehicleCheck,
}: ComplianceRemindersProps) {
  if (!hsStatus && !vehicleCheckStatus) return null;

  const vehicleUnavailable = vehicleCheckStatus === 'unavailable';
  const vehicleCheckDue = vehicleUnavailable ? null : vehicleCheckStatus;

  return (
    <section
      aria-labelledby="checks-due-heading"
      className="mb-4 rounded-xl border border-orange-700/60 bg-orange-950/30 p-4"
    >
      <h2 id="checks-due-heading" className="text-sm font-semibold text-orange-100">
        Checks due before field work
      </h2>
      <p className="mt-1 text-xs text-orange-200/80">
        Complete the checks below after clocking in and before starting work.
      </p>

      <div className="mt-3 space-y-2">
        {hsStatus && (
          <button
            type="button"
            onClick={onHsCheckin}
            className="flex w-full items-center gap-3 rounded-lg border border-orange-700/50 bg-neutral-950/50 px-3 py-3 text-left hover:bg-neutral-900"
          >
            <ShieldCheck className="h-5 w-5 shrink-0 text-orange-300" />
            <span className="flex-1">
              <span className="block text-sm font-medium text-neutral-100">
                {hsStatus === 'unavailable'
                  ? 'H&S check status unavailable'
                  : 'Daily H&S check-in'}
              </span>
              <span className="block text-xs text-neutral-400">
                {hsStatus === 'unavailable'
                  ? 'Open the check-in to verify today’s status.'
                  : 'Confirm fitness, PPE and today’s work activities.'}
              </span>
            </span>
            <span className="text-xs font-semibold text-orange-300">
              {hsStatus === 'unavailable' ? 'Open checks' : 'Complete now'}
            </span>
          </button>
        )}

        {vehicleCheckStatus && (
          <button
            type="button"
            disabled={vehiclePending}
            onClick={() => onVehicleCheck(vehicleCheckDue ?? undefined)}
            className="flex w-full items-center gap-3 rounded-lg border border-orange-700/50 bg-neutral-950/50 px-3 py-3 text-left hover:bg-neutral-900 disabled:cursor-wait disabled:opacity-60"
          >
            <Car className="h-5 w-5 shrink-0 text-orange-300" />
            <span className="flex-1">
              <span className="block text-sm font-medium text-neutral-100">
                {vehicleUnavailable
                  ? 'Vehicle check status unavailable'
                  : vehicleCheckDue === 'weekly'
                    ? 'Weekly vehicle inspection'
                    : 'Daily vehicle check'}
              </span>
              <span className="block text-xs text-neutral-400">
                {vehicleUnavailable
                  ? `Open ${vehicleRegistration ?? 'your assigned vehicle'} to verify today’s status.`
                  : `${vehicleRegistration ?? 'Assigned vehicle'} pre-trip check is due.`}
              </span>
            </span>
            <span className="text-xs font-semibold text-orange-300">
              {vehiclePending
                ? 'Opening…'
                : vehicleUnavailable
                  ? 'Open checks'
                  : 'Complete now'}
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
