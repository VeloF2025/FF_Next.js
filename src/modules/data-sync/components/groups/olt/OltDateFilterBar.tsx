/**
 * OltDateFilterBar — date period filter pills for Fix Log and Reporting tabs
 */

'use client';

import { Calendar } from 'lucide-react';
import type { DateFilter } from '../../../types';

interface OltDateFilterBarProps {
  dateFilter: DateFilter;
  customDate: string;
  onDateFilterChange: (f: DateFilter) => void;
  onCustomDateChange: (d: string) => void;
}

const DATE_OPTIONS: { key: DateFilter; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: 'all', label: 'All' },
];

export function OltDateFilterBar({ dateFilter, customDate, onDateFilterChange, onCustomDateChange }: OltDateFilterBarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-[var(--ff-text-secondary)] mr-1">
        <Calendar className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
        Period:
      </span>
      {DATE_OPTIONS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => { onDateFilterChange(key); onCustomDateChange(''); }}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
            dateFilter === key
              ? 'bg-[var(--ff-accent)] text-white border-[var(--ff-accent)]'
              : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-accent)]'
          }`}
        >
          {label}
        </button>
      ))}
      <input
        type="date"
        value={customDate}
        onChange={(e) => {
          onCustomDateChange(e.target.value);
          if (e.target.value) onDateFilterChange('custom');
        }}
        className="px-2 py-1 text-xs rounded border bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)] focus:border-[var(--ff-accent)] outline-none"
        title="Pick a specific date"
      />
    </div>
  );
}
