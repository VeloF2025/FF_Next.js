/**
 * Outcome panel for a crew check-in submission.
 *
 * The one rule here: `recorded` being smaller than the crew submitted must
 * never be the only signal. Every worker who was NOT recorded is named with
 * the reason (skipped = already checked in today), every blocked worker is
 * named with why, and workers whose contractor link could not be proven are
 * listed rather than silently accepted.
 */

import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { CHECKIN_CARD } from './CheckinPrompts';
import { CHECKIN_BLOCK_REASON_LABELS } from '../../types/checkin.types';

export interface CrewSubmitResult {
  recorded: number;
  skipped: string[];
  contractor_link_unverified: string[];
  blocked: number;
  checkins: { worker_name: string; clearance: string; blocked_reasons: string[] }[];
}

// One vocabulary for block reasons everywhere (same labels the officer board
// uses), so the lead and the officer talk about the same thing in the same
// words. Unknown codes fall back to the raw value rather than disappearing.
const reasonText = (r: string): string =>
  (CHECKIN_BLOCK_REASON_LABELS as Record<string, string>)[r] ?? r;

export function CrewOutcome({
  requested,
  result,
  onRecordAnother,
  onDone,
}: {
  /** How many crew members were in the submission. */
  requested: number;
  result: CrewSubmitResult;
  onRecordAnother: () => void;
  onDone: () => void;
}) {
  const allRecorded = result.recorded === requested;
  const blockedRows = result.checkins.filter((c) => c.clearance === 'blocked');

  return (
    <div className="space-y-4">
      <div className={`${CHECKIN_CARD} text-center`}>
        {allRecorded && result.blocked === 0 ? (
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
        ) : (
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-amber-400" />
        )}
        <h2 className="text-lg font-semibold text-neutral-100">
          Recorded {result.recorded} of {requested}
        </h2>
        {!allRecorded && (
          <p className="mt-2 text-sm text-amber-300">
            Not everyone was recorded — the workers who were not are named below.
          </p>
        )}
      </div>

      {result.skipped.length > 0 && (
        <div className={CHECKIN_CARD} role="alert">
          <p className="text-sm font-medium text-amber-300">
            Not recorded — already checked in today:
          </p>
          <ul className="mt-2 space-y-1 text-sm text-neutral-200">
            {result.skipped.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}

      {blockedRows.length > 0 && (
        <div className={CHECKIN_CARD} role="alert">
          <p className="text-sm font-medium text-red-300">
            Recorded but NOT cleared to start — the H&amp;S officer must clear them:
          </p>
          <ul className="mt-2 space-y-1 text-sm text-neutral-200">
            {blockedRows.map((c) => (
              <li key={c.worker_name}>
                {c.worker_name}
                <span className="text-red-300">
                  {' — '}
                  {c.blocked_reasons.map(reasonText).join('; ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.contractor_link_unverified.length > 0 && (
        <div className={CHECKIN_CARD}>
          <p className="flex items-start gap-2 text-sm text-neutral-300">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-sky-400" />
            <span>
              Recorded, but the register does not link them to this contractor yet, so
              their details could not be verified:
            </span>
          </p>
          <ul className="mt-2 space-y-1 text-sm text-neutral-200">
            {result.contractor_link_unverified.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={onRecordAnother}
        className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg"
      >
        Record another crew
      </button>
      <button
        onClick={onDone}
        className="w-full px-4 py-2.5 bg-neutral-800 text-neutral-100 rounded-lg"
      >
        Back to hub
      </button>
    </div>
  );
}
