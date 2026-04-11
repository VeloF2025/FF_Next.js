'use client';

import { Search, XCircle, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PPDataFiltersProps {
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
  onExport: () => void;
}

export function PPDataFilters({
  searchText, onSearchChange,
  filterProject, onProjectChange,
  filterStatus, onStatusChange,
  filterPriority, onPriorityChange,
  filterAging, onAgingChange,
  filterDateFrom, onDateFromChange,
  filterDateTo, onDateToChange,
  onExport,
}: PPDataFiltersProps) {
  return (
    <div className="bg-[var(--ff-bg-primary)] px-4 py-3 border-b border-[var(--ff-border-light)] flex flex-wrap gap-3 items-center">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)]" />
        <input
          type="text"
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search serial, DR, ticket..."
          className="pl-8 pr-3 py-1.5 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                     text-[var(--ff-text-primary)] text-sm w-56 placeholder:text-[var(--ff-text-tertiary)]"
        />
        {searchText && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2"
            aria-label="Clear search"
          >
            <XCircle className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <select
        value={filterProject}
        onChange={(e) => onProjectChange(e.target.value)}
        className="px-3 py-1.5 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                   text-[var(--ff-text-primary)] text-sm"
      >
        <option value="">All Projects</option>
        <option value="Lawley">Lawley</option>
        <option value="Mohadin">Mohadin</option>
        <option value="Mamelodi">Mamelodi</option>
      </select>
      <select
        value={filterStatus}
        onChange={(e) => onStatusChange(e.target.value)}
        className="px-3 py-1.5 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                   text-[var(--ff-text-primary)] text-sm"
      >
        <option value="">All Statuses</option>
        <option value="unticketed">Unticketed</option>
        <option value="not_found">Not Found</option>
        <option value="located_oes">Found (OES)</option>
        <option value="located_unified">Found (Unified)</option>
        <option value="located_onemap">Found (OneMap)</option>
        <option value="located_1map">Found (1Map)</option>
        <option value="located_local">Found (Local)</option>
        <option value="activated">Activated</option>
      </select>
      <select
        value={filterPriority}
        onChange={(e) => onPriorityChange(e.target.value)}
        className="px-3 py-1.5 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                   text-[var(--ff-text-primary)] text-sm"
      >
        <option value="">All Priorities</option>
        <option value="normal">Normal</option>
        <option value="high">High</option>
      </select>
      <select
        value={filterAging}
        onChange={(e) => onAgingChange(e.target.value)}
        className={`px-3 py-1.5 rounded border text-sm ${
          filterAging
            ? 'bg-red-900/20 border-red-700 text-red-300'
            : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] text-[var(--ff-text-primary)]'
        }`}
      >
        <option value="">Ticket Age</option>
        <option value="recent">Recent (0-6 days)</option>
        <option value="7days">7 Days (7-13 days)</option>
        <option value="14days">14+ Days</option>
      </select>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-[var(--ff-text-tertiary)]">From</label>
        <input
          type="date"
          value={filterDateFrom}
          onChange={(e) => onDateFromChange(e.target.value)}
          className="px-2 py-1.5 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                     text-[var(--ff-text-primary)] text-sm"
        />
        <label className="text-xs text-[var(--ff-text-tertiary)]">To</label>
        <input
          type="date"
          value={filterDateTo}
          onChange={(e) => onDateToChange(e.target.value)}
          className="px-2 py-1.5 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                     text-[var(--ff-text-primary)] text-sm"
        />
        {(filterDateFrom || filterDateTo) && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { onDateFromChange(''); onDateToChange(''); }}
            title="Clear dates"
          >
            <XCircle className="w-4 h-4" />
          </Button>
        )}
      </div>
      <div className="ml-auto">
        <Button variant="secondary" size="sm" onClick={onExport}>
          <Download className="w-3.5 h-3.5" /> Export Excel
        </Button>
      </div>
    </div>
  );
}
