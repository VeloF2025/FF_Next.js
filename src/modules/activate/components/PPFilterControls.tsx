/**
 * PPFilterControls — left-side filter inputs: search, project, status chips,
 * date range, PON, Priority, and Aging selects.
 * Split from PPDataFilters to keep both components under 200 lines.
 */

'use client';

import { Search, XCircle } from 'lucide-react';

interface PPFilterControlsProps {
  projects: string[];
  searchText: string;
  onSearchChange: (val: string) => void;
  filterProject: string;
  onProjectChange: (val: string) => void;
  filterStatus: string;
  onStatusChange: (val: string) => void;
  filterPriority: string;
  onPriorityChange: (val: string) => void;
  filterAging: string;
  onAgingChange: (val: string) => void;
  filterDateFrom: string;
  onDateFromChange: (val: string) => void;
  filterDateTo: string;
  onDateToChange: (val: string) => void;
  filterPon: string;
  onPonChange: (val: string) => void;
}

const STATUS_CHIPS = [
  { value: '',           label: 'All' },
  { value: 'not_found',  label: 'Not Found' },
  { value: 'located',    label: 'Located' },
  { value: 'activated',  label: 'Activated' },
  { value: 'ticketed',   label: 'Ticketed' },
  { value: 'unticketed', label: 'Unticketed' },
] as const;

const PON_OPTIONS = Array.from({ length: 16 }, (_, i) => i + 1);

const SELECT_CLASS =
  'px-2 py-1.5 rounded bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-xs focus:outline-none focus:ring-1 focus:ring-[var(--ff-accent)]/50';

export function PPFilterControls({
  projects,
  searchText, onSearchChange,
  filterProject, onProjectChange,
  filterStatus, onStatusChange,
  filterPriority, onPriorityChange,
  filterAging, onAgingChange,
  filterDateFrom, onDateFromChange,
  filterDateTo, onDateToChange,
  filterPon, onPonChange,
}: PPFilterControlsProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
      {/* Search */}
      <div className="relative w-52 shrink-0">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)]" />
        <input
          type="text"
          value={searchText}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search serial, DR, ticket..."
          className="w-full pl-8 pr-7 py-1.5 rounded bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)]
                     text-[var(--ff-text-primary)] text-xs placeholder:text-[var(--ff-text-tertiary)]
                     focus:outline-none focus:ring-1 focus:ring-[var(--ff-accent)]/50"
        />
        {searchText && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
            aria-label="Clear search"
          >
            <XCircle className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Project select */}
      <select value={filterProject} onChange={e => onProjectChange(e.target.value)} className={SELECT_CLASS}>
        <option value="">All Projects</option>
        {projects.map(p => <option key={p} value={p}>{p}</option>)}
      </select>

      {/* Status pill chips */}
      <span className="text-xs text-[var(--ff-text-secondary)] mr-1">Filter:</span>
      {STATUS_CHIPS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => onStatusChange(value)}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
            filterStatus === value
              ? 'bg-[var(--ff-accent)] text-white border-[var(--ff-accent)]'
              : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-accent)]'
          }`}
        >
          {label}
        </button>
      ))}

      {/* Date range */}
      <span className="text-xs text-[var(--ff-text-secondary)]">From</span>
      <input
        type="date" value={filterDateFrom} onChange={e => onDateFromChange(e.target.value)}
        className="px-2 py-1 text-xs rounded border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)] focus:border-[var(--ff-accent)] outline-none"
        aria-label="Date from"
      />
      <span className="text-xs text-[var(--ff-text-secondary)]">To</span>
      <input
        type="date" value={filterDateTo} onChange={e => onDateToChange(e.target.value)}
        className="px-2 py-1 text-xs rounded border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)] focus:border-[var(--ff-accent)] outline-none"
        aria-label="Date to"
      />
      {(filterDateFrom || filterDateTo) && (
        <button
          onClick={() => { onDateFromChange(''); onDateToChange(''); }}
          className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]" title="Clear dates"
        >
          <XCircle className="w-3.5 h-3.5" />
        </button>
      )}

      {/* PON / Priority / Aging selects */}
      <select value={filterPon} onChange={e => onPonChange(e.target.value)}
        className={`${SELECT_CLASS} ${filterPon ? 'bg-indigo-900/20 border-indigo-600 text-indigo-300' : ''}`}>
        <option value="">All PONs</option>
        {PON_OPTIONS.map(n => <option key={n} value={String(n)}>PON {n}</option>)}
      </select>

      <select value={filterPriority} onChange={e => onPriorityChange(e.target.value)} className={SELECT_CLASS}>
        <option value="">All Priorities</option>
        <option value="normal">Normal</option>
        <option value="high">High</option>
      </select>

      <select value={filterAging} onChange={e => onAgingChange(e.target.value)}
        className={`${SELECT_CLASS} ${filterAging ? 'bg-red-900/20 border-red-700 text-red-300' : ''}`}>
        <option value="">Ticket Age</option>
        <option value="recent">Recent (0-6 days)</option>
        <option value="7days">7 Days (7-13 days)</option>
        <option value="14days">14+ Days</option>
      </select>
    </div>
  );
}
