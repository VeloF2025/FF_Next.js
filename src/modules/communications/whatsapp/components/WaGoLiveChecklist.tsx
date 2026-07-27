/**
 * The manual go-live checklist.
 *
 * Nothing here self-ticks: every step happens in the Meta dashboard or on a
 * handset, so an auto-derived tick would be asserting something the app cannot
 * observe. The machine-checked facts live in the readiness panel instead.
 */

import React from 'react';
import { WA_GO_LIVE_CHECKLIST } from './goLiveChecklist';

const WaGoLiveChecklist: React.FC = () => (
  <section
    data-testid="wa-golive-checklist"
    className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden"
  >
    <div className="bg-[var(--ff-bg-secondary)] px-4 py-3 border-b border-[var(--ff-border-light)]">
      <h4 className="font-medium text-[var(--ff-text-primary)]">Go-live checklist</h4>
      <p className="text-sm text-[var(--ff-text-secondary)]">
        Manual steps — the app cannot verify these, so nothing here self-ticks.
      </p>
    </div>
    <ol className="divide-y divide-[var(--ff-border-light)]">
      {WA_GO_LIVE_CHECKLIST.map((item, index) => (
        <li
          key={item.id}
          data-testid={`wa-checklist-item-${item.id}`}
          className="px-4 py-3 flex gap-3"
        >
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] text-xs font-medium flex items-center justify-center">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="font-medium text-[var(--ff-text-primary)]">{item.title}</p>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-0.5">{item.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  </section>
);

export default WaGoLiveChecklist;
