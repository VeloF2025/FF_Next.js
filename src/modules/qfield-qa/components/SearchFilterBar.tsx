/**
 * Search & Filter Bar Component
 * Search input + workflow status filter + active filter chips
 */

'use client';

import { useState, useCallback } from 'react';
import { Search, X, Filter } from 'lucide-react';
import type { QAFilters, WorkflowStatus, Priority } from '../types';

interface SearchFilterBarProps {
  filters: QAFilters;
  onFilterChange: (filters: Partial<QAFilters>) => void;
  onClearFilters: () => void;
  /** Active hierarchy breadcrumb for context */
  breadcrumb?: string;
}

export function SearchFilterBar({
  filters,
  onFilterChange,
  onClearFilters,
  breadcrumb,
}: SearchFilterBarProps) {
  const [searchTerm, setSearchTerm] = useState(filters.search || '');

  const handleSearch = useCallback(() => {
    onFilterChange({ search: searchTerm || undefined });
  }, [searchTerm, onFilterChange]);

  const handleClearSearch = useCallback(() => {
    setSearchTerm('');
    onFilterChange({ search: undefined });
  }, [onFilterChange]);

  // Count active non-hierarchy filters
  const activeFilterCount = [
    filters.workflowStatus,
    filters.priority,
    filters.search,
    filters.needsRetake,
  ].filter(Boolean).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search by pole number, feature ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="w-full pl-10 pr-8 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
          />
          {searchTerm && (
            <button
              onClick={handleClearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Status Filter */}
        <select
          value={filters.workflowStatus || ''}
          onChange={(e) => onFilterChange({ workflowStatus: (e.target.value as WorkflowStatus) || undefined })}
          className="px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_review">In Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="escalated">Escalated</option>
        </select>

        {/* Priority Filter */}
        <select
          value={filters.priority || ''}
          onChange={(e) => onFilterChange({ priority: (e.target.value as Priority) || undefined })}
          className="px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        >
          <option value="">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>

        {/* Clear All */}
        {activeFilterCount > 0 && (
          <button
            onClick={onClearFilters}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Active filter chips + breadcrumb */}
      {(breadcrumb || activeFilterCount > 0) && (
        <div className="flex flex-wrap gap-1.5 items-center">
          {breadcrumb && (
            <span className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-blue-500/15 text-blue-400 rounded-md">
              <Filter className="w-3 h-3" />
              {breadcrumb}
            </span>
          )}
          {filters.workflowStatus && (
            <FilterChip
              label={`Status: ${filters.workflowStatus}`}
              onRemove={() => onFilterChange({ workflowStatus: undefined })}
            />
          )}
          {filters.priority && (
            <FilterChip
              label={`Priority: ${filters.priority}`}
              onRemove={() => onFilterChange({ priority: undefined })}
            />
          )}
          {filters.search && (
            <FilterChip
              label={`Search: "${filters.search}"`}
              onRemove={handleClearSearch}
            />
          )}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] rounded-md">
      {label}
      <button onClick={onRemove} className="hover:text-[var(--ff-text-primary)]">
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

export default SearchFilterBar;
