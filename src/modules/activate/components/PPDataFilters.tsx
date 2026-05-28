/**
 * PPDataFilters — two-row filter bar matching the OLT Investigate layout.
 *
 * Row 1 (filters): DateChipFilter + PPFilterControls (search, project, status
 * chips, sub-selects). Row 2 (actions): Export / Resolve All / Ticket All /
 * Refresh / Import OLT Data.
 */

'use client';

import { useRef, type ChangeEvent } from 'react';
import { Download, RefreshCw, Upload, Ticket, XCircle, Search } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { DateChipFilter } from '@/modules/data-sync/components/DateChipFilter';
import type { DateFilter } from '@/modules/data-sync/types';
import { PPFilterControls } from './PPFilterControls';

interface PPDataFiltersProps {
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
  dateFilter: DateFilter;
  onDateFilterChange: (val: DateFilter) => void;
  customDateFrom: string;
  onCustomDateFromChange: (val: string) => void;
  customDateTo: string;
  onCustomDateToChange: (val: string) => void;
  filterPon: string;
  onPonChange: (val: string) => void;
  // Action props
  total: number;
  selectedCount: number;
  onExport: () => void;
  onImportOlt: (file: File) => void;
  isImportingOlt: boolean;
  onResolveAll: () => void;
  isResolving: boolean;
  isLookupRunning: boolean;
  unticketedCount: number;
  onSelectAllUnticketed: () => void;
  isSelectingAllUnticketed: boolean;
  onCreateTickets: () => void;
  onClearSelection: () => void;
  onRefresh: () => void;
}

export function PPDataFilters({
  projects, searchText, onSearchChange,
  filterProject, onProjectChange,
  filterStatus, onStatusChange,
  filterPriority, onPriorityChange,
  filterAging, onAgingChange,
  dateFilter, onDateFilterChange,
  customDateFrom, onCustomDateFromChange,
  customDateTo, onCustomDateToChange,
  filterPon, onPonChange,
  total, selectedCount,
  onExport, onImportOlt, isImportingOlt,
  onResolveAll, isResolving, isLookupRunning,
  unticketedCount, onSelectAllUnticketed, isSelectingAllUnticketed,
  onCreateTickets, onClearSelection, onRefresh,
}: PPDataFiltersProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) { onImportOlt(file); e.target.value = ''; }
  }

  return (
    <div className="px-4 py-3 border-b border-[var(--ff-border-light)] space-y-3">
      {/* Row 1: filters (date chips + search + project + status chips + sub-selects) */}
      <div className="flex items-center gap-3 flex-wrap">
        <DateChipFilter
          dateFilter={dateFilter}
          customDateFrom={customDateFrom}
          customDateTo={customDateTo}
          onDateFilterChange={onDateFilterChange}
          onCustomDateFromChange={onCustomDateFromChange}
          onCustomDateToChange={onCustomDateToChange}
        />
        <PPFilterControls
          projects={projects}
          searchText={searchText} onSearchChange={onSearchChange}
          filterProject={filterProject} onProjectChange={onProjectChange}
          filterStatus={filterStatus} onStatusChange={onStatusChange}
          filterPriority={filterPriority} onPriorityChange={onPriorityChange}
          filterAging={filterAging} onAgingChange={onAgingChange}
          filterPon={filterPon} onPonChange={onPonChange}
        />
      </div>

      {/* Row 2: action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onExport} disabled={total === 0}
          className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)]
                     text-xs rounded hover:border-[var(--ff-accent)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          <Download className="w-3 h-3" /> Export Excel ({total})
        </button>

        <button
          onClick={onResolveAll} disabled={isResolving || isLookupRunning}
          className="px-3 py-1.5 bg-[var(--ff-accent)] text-white text-xs rounded hover:bg-[var(--ff-accent)]/80 disabled:opacity-50 flex items-center gap-1.5"
        >
          {isResolving ? <><InlineSpinner size="sm" /> Resolving...</>
            : isLookupRunning ? <><InlineSpinner size="sm" /> 1Map Searching...</>
            : <><Search className="w-3 h-3" /> Resolve All</>}
        </button>

        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        <button
          onClick={() => fileInputRef.current?.click()} disabled={isImportingOlt}
          className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)]
                     text-xs rounded hover:border-[var(--ff-accent)] disabled:opacity-50 flex items-center gap-1.5"
          title="Import Velocity PPs Excel to populate OLT port data"
        >
          {isImportingOlt ? <><InlineSpinner size="sm" /> Importing...</> : <><Upload className="w-3 h-3" /> Import OLT Data</>}
        </button>

        {unticketedCount > 0 && (
          <button
            onClick={onSelectAllUnticketed} disabled={isSelectingAllUnticketed}
            className="px-3 py-1.5 bg-amber-600 text-white text-xs rounded hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isSelectingAllUnticketed ? <><InlineSpinner size="sm" /> Loading...</>
              : <><Ticket className="w-3 h-3" /> Ticket All Unticketed ({unticketedCount})</>}
          </button>
        )}

        {selectedCount > 0 && (
          <>
            <button
              onClick={onCreateTickets}
              className="px-3 py-1.5 bg-red-600 text-white text-xs rounded hover:bg-red-700 flex items-center gap-1.5"
            >
              <Ticket className="w-3 h-3" /> Create {selectedCount} Ticket{selectedCount !== 1 ? 's' : ''}
            </button>
            <button
              onClick={onClearSelection}
              className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)]
                         text-xs rounded hover:border-[var(--ff-accent)] flex items-center gap-1.5"
            >
              <XCircle className="w-3 h-3" /> Clear
            </button>
          </>
        )}

        <button
          onClick={onRefresh}
          className="ml-auto p-1.5 text-[var(--ff-text-secondary)] hover:text-[var(--ff-accent)] transition-colors"
          title="Refresh data" aria-label="Refresh PP data"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
