/**
 * Site-only questions plus small shared pieces for HsCheckinSteps — split
 * out to keep that file under the 200-line limit. Wording mirrors
 * pages/my/hs-checkin.tsx exactly.
 */

import {
  YesNo,
  ActivityPicker,
  CheckinOutcome,
  CHECKIN_CARD,
  type CheckinActivityOption,
} from '@/modules/health-safety/components/checkin/CheckinPrompts';

const labelCls = 'block text-sm font-medium text-neutral-200 mb-2';
const inputCls =
  'w-full px-3 py-2.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-100 focus:outline-none focus:ring-2 focus:ring-emerald-500';

export function LocationOption(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onClick}
      className={`px-3 py-2.5 rounded-lg border text-sm text-left ${
        props.active
          ? 'bg-emerald-600 border-emerald-500 text-white'
          : 'bg-neutral-950 border-neutral-700 text-neutral-300'
      }`}
    >
      {props.label}
    </button>
  );
}

/** Fit-for-duty question, shown regardless of work location. */
export function FitForDutyCard(props: { fit: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className={CHECKIN_CARD}>
      <span className={labelCls}>Are you fit and well enough to work safely today?</span>
      <YesNo value={props.fit} onChange={props.onChange} noLabel="No, I am not" yesLabel="Yes, I am" />
      {props.fit === false && (
        <p className="mt-3 text-sm text-amber-300">
          Thank you for saying so. You will not be cleared to start, and someone will contact you.
          Your time is already recorded — this answer does not affect it.
        </p>
      )}
    </div>
  );
}

export function HsCheckinSiteQuestions(props: {
  ppe: boolean | null;
  onPpeChange: (v: boolean) => void;
  activities: CheckinActivityOption[];
  selected: string[];
  onSelectedChange: (v: string[]) => void;
  hazard: string;
  onHazardChange: (v: string) => void;
  medicalStatus: string | null;
}) {
  // Same gate as pages/my/hs-checkin.tsx: a selected activity that needs a
  // medical, with no current Certificate of Fitness on file.
  const medicalGated = props.selected.some(
    (s) => props.activities.find((a) => a.value === s)?.requires_medical
  );

  return (
    <>
      <div className={CHECKIN_CARD}>
        <span className={labelCls}>Do you have all the PPE you need for today?</span>
        <YesNo
          value={props.ppe}
          onChange={props.onPpeChange}
          noLabel="No, something is missing"
          yesLabel="Yes, all of it"
        />
      </div>

      <div className={CHECKIN_CARD}>
        <span className={labelCls}>Will you do any of these today?</span>
        <p className="text-xs text-neutral-400 mb-3">Leave them all unticked if none apply.</p>
        <ActivityPicker
          options={props.activities}
          selected={props.selected}
          onChange={props.onSelectedChange}
        />
        {medicalGated && props.medicalStatus && props.medicalStatus !== 'current' && (
          <p className="mt-3 text-sm text-red-300">
            Our records show no current Certificate of Fitness for you. If you select this work you
            will not be cleared to do it — speak to the H&S officer.
          </p>
        )}
      </div>

      <div className={CHECKIN_CARD}>
        <label className={labelCls} htmlFor="hs-hazard">
          Seen anything unsafe? (optional)
        </label>
        <textarea
          id="hs-hazard"
          className={inputCls}
          rows={3}
          placeholder="e.g. open trench with no barrier near the gate"
          value={props.hazard}
          onChange={(e) => props.onHazardChange(e.target.value)}
        />
        <p className="mt-2 text-xs text-neutral-400">
          This goes straight to the risk register. Reporting a hazard never counts against you.
        </p>
      </div>
    </>
  );
}

/**
 * The declaration's outcome. The reassurance under a block is the load-bearing
 * part: a worker told they are "not cleared" seconds after clocking in will
 * assume the clock-in failed too, and clock in again.
 */
export function HsCheckinOutcomeCard(props: {
  clearance: string;
  reasons: string[];
  onDone: () => void;
}) {
  return (
    <div className="space-y-3">
      <CheckinOutcome clearance={props.clearance} reasons={props.reasons} onDone={props.onDone} />
      {props.clearance === 'blocked' && (
        <p className={`${CHECKIN_CARD} text-sm text-amber-300`}>
          Your time has been recorded for today&apos;s shift already — that is not affected. Report
          to your supervisor before you start work.
        </p>
      )}
    </div>
  );
}
