/**
 * SingleDateChipFilter — chip strip that emits a SINGLE YYYY-MM-DD date.
 *
 * Sibling to DateChipFilter. The shared `DateChipFilter` produces a from/to
 * range — appropriate for list/table views that span days. Some APIs (like
 * `/api/eod/reconciliation?date=`) are per-day by design, so we offer a
 * single-date chip variant that mirrors the OLT Investigate aesthetic while
 * keeping the API contract intact.
 *
 * Chips: Today / Yesterday / Custom. No 7d/30d/all chips — those are ranges.
 */

'use client';

import { Calendar } from 'lucide-react';

export type SingleDateChip = 'today' | 'yesterday' | 'custom';

interface SingleDateChipFilterProps {
  /** Active chip. */
  chip: SingleDateChip;
  /** Selected YYYY-MM-DD date (always populated; chip is the UX hint). */
  date: string;
  /** Called when the user picks a chip or types in a Custom date. Receives
   *  the new chip plus the resolved YYYY-MM-DD date. */
  onChange: (chip: SingleDateChip, date: string) => void;
  label?: string;
}

function ymd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const CHIPS: { key: SingleDateChip; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'custom', label: 'Custom' },
];

export function SingleDateChipFilter({
  chip,
  date,
  onChange,
  label = 'Date:',
}: SingleDateChipFilterProps) {
  const handleChip = (next: SingleDateChip) => {
    if (next === 'today') {
      onChange(next, ymd(new Date()));
    } else if (next === 'yesterday') {
      const now = new Date();
      onChange(next, ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)));
    } else {
      onChange(next, date);
    }
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-[var(--ff-text-secondary)] mr-1">
        <Calendar className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
        {label}
      </span>
      {CHIPS.map(({ key, label: chipLabel }) => (
        <button
          key={key}
          type="button"
          onClick={() => handleChip(key)}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
            chip === key
              ? 'bg-[var(--ff-accent)] text-white border-[var(--ff-accent)]'
              : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-accent)]'
          }`}
        >
          {chipLabel}
        </button>
      ))}
      {chip === 'custom' && (
        <input
          type="date"
          value={date}
          onChange={(e) => onChange('custom', e.target.value)}
          className="px-2 py-1 text-xs rounded border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)] focus:border-[var(--ff-accent)] outline-none"
          aria-label="Custom date"
        />
      )}
    </div>
  );
}
