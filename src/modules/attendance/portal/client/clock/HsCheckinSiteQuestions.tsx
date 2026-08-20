/**
 * Site-only questions for HsCheckinSteps — split out to keep that file under
 * the 200-line limit. Wording mirrors pages/my/hs-checkin.tsx exactly.
 */

import {
  YesNo,
  ActivityPicker,
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

export function HsCheckinSiteQuestions(props: {
  ppe: boolean | null;
  onPpeChange: (v: boolean) => void;
  activities: CheckinActivityOption[];
  selected: string[];
  onSelectedChange: (v: string[]) => void;
  hazard: string;
  onHazardChange: (v: string) => void;
}) {
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
