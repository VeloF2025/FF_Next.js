/**
 * DateChipFilter — shared date period chip filter modelled on OLT Investigate.
 *
 * Renders a row of pill chips ([Today] [Yesterday] [7 Days] [30 Days] [Custom] [All])
 * with a from/to date input pair that appears when Custom is active.
 *
 * Callers own `dateFilter` plus `customDateFrom`/`customDateTo` state and translate
 * them into API params using `getDateRange` from `../types.ts` (for presets) or by
 * sending the custom strings as-is.
 */

'use client';

import { Calendar } from 'lucide-react';
import type { DateFilter } from '../types';

interface DateChipFilterProps {
  dateFilter: DateFilter;
  onDateFilterChange: (f: DateFilter) => void;
  /** Custom-range state. Required unless `omitCustom` is true. */
  customDateFrom?: string;
  customDateTo?: string;
  onCustomDateFromChange?: (d: string) => void;
  onCustomDateToChange?: (d: string) => void;
  label?: string;
  /** Hide the Custom chip + from/to inputs. Use when the consuming API does
   *  not accept a from/to range (e.g. OLT reporting takes a `period` enum).
   *  When set, the four `custom*` props become unnecessary and can be omitted. */
  omitCustom?: boolean;
}

const ALL_DATE_OPTIONS: { key: DateFilter; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: 'custom', label: 'Custom' },
  { key: 'all', label: 'All' },
];

export function DateChipFilter({
  dateFilter,
  customDateFrom = '',
  customDateTo = '',
  onDateFilterChange,
  onCustomDateFromChange,
  onCustomDateToChange,
  label = 'Date:',
  omitCustom = false,
}: DateChipFilterProps) {
  const options = omitCustom ? ALL_DATE_OPTIONS.filter(o => o.key !== 'custom') : ALL_DATE_OPTIONS;
  // If a caller asks to show Custom but forgets to wire the callbacks, fail
  // loudly in dev rather than render dead inputs (silent-footgun guard).
  if (process.env.NODE_ENV !== 'production' && !omitCustom && (!onCustomDateFromChange || !onCustomDateToChange)) {
    throw new Error('DateChipFilter: onCustomDateFromChange/onCustomDateToChange required when omitCustom is false');
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-[var(--ff-text-secondary)] mr-1">
        <Calendar className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
        {label}
      </span>
      {options.map(({ key, label: chipLabel }) => (
        <button
          key={key}
          type="button"
          onClick={() => onDateFilterChange(key)}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
            dateFilter === key
              ? 'bg-[var(--ff-accent)] text-white border-[var(--ff-accent)]'
              : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-accent)]'
          }`}
        >
          {chipLabel}
        </button>
      ))}
      {dateFilter === 'custom' && !omitCustom && (
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={customDateFrom}
            onChange={(e) => onCustomDateFromChange?.(e.target.value)}
            className="px-2 py-1 text-xs rounded border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)] focus:border-[var(--ff-accent)] outline-none"
            aria-label="Custom date from"
          />
          <span className="text-[var(--ff-text-tertiary)] text-xs">to</span>
          <input
            type="date"
            value={customDateTo}
            onChange={(e) => onCustomDateToChange?.(e.target.value)}
            className="px-2 py-1 text-xs rounded border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)] focus:border-[var(--ff-accent)] outline-none"
            aria-label="Custom date to"
          />
        </div>
      )}
    </div>
  );
}
