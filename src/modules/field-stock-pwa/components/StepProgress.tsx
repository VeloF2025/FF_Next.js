/**
 * StepProgress — numbered dot progress indicator for the issue flow.
 *
 * Extracted from IssueOrchestrator to keep component files under 200 lines.
 * Renders an ordered list of numbered circles with active/done/pending states.
 */

import React from 'react';

// =============================================================================
// Props
// =============================================================================

export interface StepProgressProps {
  /** 1-based index of the currently active step. */
  current: number;
  /** Short labels for each step (length determines total step count). */
  labels: string[];
}

// =============================================================================
// Component
// =============================================================================

export function StepProgress({ current, labels }: StepProgressProps) {
  return (
    <ol className="flex items-center gap-1" aria-label="Progress">
      {labels.map((label, idx) => {
        const stepNum = idx + 1;
        const isActive = stepNum === current;
        const isDone = stepNum < current;
        return (
          <React.Fragment key={label}>
            {idx > 0 && (
              <li aria-hidden="true" className="h-px w-3 bg-neutral-700" />
            )}
            <li
              aria-current={isActive ? 'step' : undefined}
              aria-label={`Step ${stepNum}: ${label}`}
              className={[
                'flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold border transition-colors',
                isActive
                  ? 'bg-emerald-600 border-emerald-500 text-white'
                  : isDone
                    ? 'bg-emerald-900/50 border-emerald-800 text-emerald-400'
                    : 'bg-neutral-900 border-neutral-700 text-neutral-500',
              ].join(' ')}
            >
              {stepNum}
            </li>
          </React.Fragment>
        );
      })}
    </ol>
  );
}
