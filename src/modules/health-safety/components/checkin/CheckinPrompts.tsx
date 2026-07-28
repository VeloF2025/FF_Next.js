/**
 * Presentational pieces of the /my daily H&S check-in.
 *
 * Split out of pages/my/hs-checkin.tsx to keep both files inside the size
 * limits. Styled for the /my portal's dark theme rather than the desktop
 * design system, because that is where they render.
 */

import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export const CHECKIN_CARD = 'rounded-xl border border-neutral-800 bg-neutral-900/60 p-4';

/**
 * A yes/no answer where BOTH options are equally prominent.
 *
 * Styling "yes" as the primary action would nudge a tired person through the
 * safe-looking path without reading the question — which is precisely the
 * failure mode a fitness declaration must not have.
 */
export function YesNo({
  value,
  onChange,
  yesLabel,
  noLabel,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  yesLabel: string;
  noLabel: string;
}) {
  const options = [
    { v: true, label: yesLabel, on: 'bg-emerald-600 border-emerald-500 text-white' },
    { v: false, label: noLabel, on: 'bg-amber-600 border-amber-500 text-white' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((opt) => (
        <button
          key={String(opt.v)}
          type="button"
          aria-pressed={value === opt.v}
          onClick={() => onChange(opt.v)}
          className={`px-3 py-2.5 rounded-lg border text-sm ${
            value === opt.v ? opt.on : 'bg-neutral-950 border-neutral-700 text-neutral-300'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export interface CheckinActivityOption {
  value: string;
  label: string;
  requires_medical: boolean;
}

/** The "what will you/they do today" multi-select, shared by self and crew. */
export function ActivityPicker({
  options,
  selected,
  onChange,
}: {
  options: CheckinActivityOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((a) => (
        <label key={a.value} className="flex items-center gap-3 text-sm text-neutral-200">
          <input
            type="checkbox"
            className="w-4 h-4"
            checked={selected.includes(a.value)}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...selected, a.value] : selected.filter((v) => v !== a.value)
              )
            }
          />
          {a.label}
          {a.requires_medical && <span className="text-xs text-neutral-500">needs a medical</span>}
        </label>
      ))}
    </div>
  );
}

const BLOCK_REASON_TEXT: Record<string, string> = {
  self_declared_unfit: 'You told us you are not fit for duty',
  medical_not_current: 'No current Certificate of Fitness for the work you selected',
};

/**
 * The outcome screen.
 *
 * A blocked worker is told plainly not to start, and told that someone else
 * has to clear them — they cannot resolve it themselves, so offering a retry
 * would only teach them to change their answer.
 */
export function CheckinOutcome({
  clearance,
  reasons,
  onDone,
}: {
  clearance: string;
  reasons: string[];
  onDone: () => void;
}) {
  const blocked = clearance === 'blocked';
  return (
    <div className={`${CHECKIN_CARD} text-center`}>
      {blocked ? (
        <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-red-400" />
      ) : (
        <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
      )}
      <h2 className="text-lg font-semibold text-neutral-100">
        {blocked ? 'Do not start work' : 'Check-in recorded'}
      </h2>
      <p className="mt-2 text-sm text-neutral-300">
        {blocked
          ? 'The H&S officer has been notified and must clear you before you start. Your time today is not affected.'
          : 'Thank you. Stay safe today.'}
      </p>
      {blocked && reasons.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-red-300">
          {reasons.map((r) => (
            <li key={r}>{BLOCK_REASON_TEXT[r] ?? r}</li>
          ))}
        </ul>
      )}
      <button
        onClick={onDone}
        className="mt-5 w-full px-4 py-2.5 bg-neutral-800 text-neutral-100 rounded-lg"
      >
        Back to hub
      </button>
    </div>
  );
}

/** Shown when the person has already declared today. */
export function CheckinAlreadyDone({ onDone }: { onDone: () => void }) {
  return (
    <div className={`${CHECKIN_CARD} text-center`}>
      <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
      <p className="text-neutral-200">You have already checked in today.</p>
      <button
        onClick={onDone}
        className="mt-5 w-full px-4 py-2.5 bg-neutral-800 text-neutral-100 rounded-lg"
      >
        Back to hub
      </button>
    </div>
  );
}
