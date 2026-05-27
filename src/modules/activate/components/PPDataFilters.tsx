/**
 * PPDataFilters — single filter bar row styled to match OltInvestigateTab's filter bar.
 * LEFT: delegated to PPFilterControls. RIGHT: action buttons.
 */

'use client';

import { useRef, type ChangeEvent } from 'react';
import { Download, RefreshCw, Upload, Ticket, XCircle, Search } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
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
  filterDateFrom: string;
  onDateFromChange: (val: string) => void;
  filterDateTo: string;
  onDateToChange: (val: string) => void;
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
  filterDateFrom, onDateFromChange,
  filterDateTo, onDateToChange,
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
    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ff-border-light)] gap-3 flex-wrap">
      <PPFilterControls
        projects={projects}
        searchText={searchText} onSearchChange={onSearchChange}
        filterProject={filterProject} onProjectChange={onProjectChange}
        filterStatus={filterStatus} onStatusChange={onStatusChange}
        filterPriority={filterPriority} onPriorityChange={onPriorityChange}
        filterAging={filterAging} onAgingChange={onAgingChange}
        filterDateFrom={filterDateFrom} onDateFromChange={onDateFromChange}
        filterDateTo={filterDateTo} onDateToChange={onDateToChange}
        filterPon={filterPon} onPonChange={onPonChange}
      />

      {/* RIGHT: action buttons */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
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
          className="p-1.5 text-[var(--ff-text-secondary)] hover:text-[var(--ff-accent)] transition-colors"
          title="Refresh data" aria-label="Refresh PP data"
        >
          <RefreshCw className="w-4 h-4" />
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
      </div>
    </div>
  );
}
