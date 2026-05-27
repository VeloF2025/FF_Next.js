/**
 * PickReturnReasonStep — step 1 of the /my/stores/return flow.
 *
 * The technician picks a single return reason that applies to the whole batch.
 * Per-item condition and disposition are captured at the warehouse inspect step.
 */

import React from 'react';
import { RETURN_REASONS } from '../lib/returnReasons';
import type { ReturnReason } from '../lib/returnReasons';

// =============================================================================
// Props
// =============================================================================

export interface PickReturnReasonStepProps {
  /** Pre-selected reason (pass null on first render). */
  initial: ReturnReason | null;
  /** Called when the user taps Continue with a selected reason. */
  onPick: (reason: ReturnReason) => void;
}

// =============================================================================
// Component
// =============================================================================

export function PickReturnReasonStep({ initial, onPick }: PickReturnReasonStepProps) {
  const [selected, setSelected] = React.useState<ReturnReason | null>(initial);

  return (
    <section aria-labelledby="reason-heading" className="space-y-4">
      <h2 id="reason-heading" className="text-base font-semibold text-neutral-100">
        Why are you returning stock?
      </h2>
      <p className="text-sm text-neutral-400">
        Pick one reason for the whole batch. Per-item disposition happens at the warehouse.
      </p>

      <ul className="space-y-2">
        {RETURN_REASONS.map((r) => (
          <li key={r.code}>
            <button
              type="button"
              onClick={() => setSelected(r.code)}
              aria-pressed={selected === r.code}
              className={[
                'w-full text-left rounded-xl border px-3 py-3 transition-colors',
                selected === r.code
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
                  : 'border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800/60',
              ].join(' ')}
            >
              <span className="text-sm font-medium">{r.label}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="pt-2">
        <button
          type="button"
          disabled={selected === null}
          onClick={() => {
            if (selected !== null) onPick(selected);
          }}
          className="w-full rounded-xl bg-emerald-600 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white font-medium py-3 text-sm"
        >
          Continue
        </button>
      </div>
    </section>
  );
}
