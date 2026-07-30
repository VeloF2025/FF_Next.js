import { Car, ShieldCheck } from 'lucide-react';

export type VehicleCheckDue = 'daily' | 'weekly';

interface ComplianceRemindersProps {
  hsDue: boolean;
  vehicleCheckDue: VehicleCheckDue | null;
  vehicleRegistration: string | null;
  vehiclePending: boolean;
  onHsCheckin: () => void;
  onVehicleCheck: (checkType: VehicleCheckDue) => void;
}

export function ComplianceReminders({
  hsDue,
  vehicleCheckDue,
  vehicleRegistration,
  vehiclePending,
  onHsCheckin,
  onVehicleCheck,
}: ComplianceRemindersProps) {
  if (!hsDue && !vehicleCheckDue) return null;

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
        {hsDue && (
          <button
            type="button"
            onClick={onHsCheckin}
            className="flex w-full items-center gap-3 rounded-lg border border-orange-700/50 bg-neutral-950/50 px-3 py-3 text-left hover:bg-neutral-900"
          >
            <ShieldCheck className="h-5 w-5 shrink-0 text-orange-300" />
            <span className="flex-1">
              <span className="block text-sm font-medium text-neutral-100">
                Daily H&amp;S check-in
              </span>
              <span className="block text-xs text-neutral-400">
                Confirm fitness, PPE and today&apos;s work activities.
              </span>
            </span>
            <span className="text-xs font-semibold text-orange-300">Complete now</span>
          </button>
        )}

        {vehicleCheckDue && (
          <button
            type="button"
            disabled={vehiclePending}
            onClick={() => onVehicleCheck(vehicleCheckDue)}
            className="flex w-full items-center gap-3 rounded-lg border border-orange-700/50 bg-neutral-950/50 px-3 py-3 text-left hover:bg-neutral-900 disabled:cursor-wait disabled:opacity-60"
          >
            <Car className="h-5 w-5 shrink-0 text-orange-300" />
            <span className="flex-1">
              <span className="block text-sm font-medium text-neutral-100">
                {vehicleCheckDue === 'weekly' ? 'Weekly vehicle inspection' : 'Daily vehicle check'}
              </span>
              <span className="block text-xs text-neutral-400">
                {vehicleRegistration ?? 'Assigned vehicle'} pre-trip check is due.
              </span>
            </span>
            <span className="text-xs font-semibold text-orange-300">
              {vehiclePending ? 'Opening…' : 'Complete now'}
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
