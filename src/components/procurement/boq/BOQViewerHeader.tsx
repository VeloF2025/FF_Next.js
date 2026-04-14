/**
 * BOQ Viewer Header Component
 * Includes always-visible search + category filter in the toolbar
 */

import { Filter, Download, Edit3, Eye, RefreshCw, Search } from 'lucide-react';
import { BOQWithItems } from '@/types/procurement/boq.types';
import { FilterState } from './BOQViewerTypes';
import { getStatusBadge } from './BOQViewerUtils';

interface BOQViewerHeaderProps {
  boqData: BOQWithItems;
  mode: 'view' | 'edit';
  setMode: (mode: 'view' | 'edit') => void;
  showFilters: boolean;
  setShowFilters: (show: boolean) => void;
  onExport: () => void;
  onRefresh: () => void;
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
  filterOptions: { phases: string[]; categories: string[] };
}

export default function BOQViewerHeader({
  boqData,
  mode,
  setMode,
  showFilters,
  setShowFilters,
  onExport,
  onRefresh,
  filters,
  setFilters,
  filterOptions
}: BOQViewerHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">
            {boqData.title || boqData.fileName || 'BOQ Viewer'}
          </h2>
          <div className="flex items-center space-x-4 mt-1">
            <span className="text-sm text-[var(--ff-text-secondary)]">
              Version {boqData.version}
            </span>
            <span className={getStatusBadge(boqData.status, 'mapping')}>
              {boqData.status.replace('_', ' ').toUpperCase()}
            </span>
            <span className="text-sm text-[var(--ff-text-secondary)]">
              {boqData.itemCount} items
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setMode(mode === 'view' ? 'edit' : 'view')}
            className={`px-3 py-2 rounded-md text-sm font-medium flex items-center ${
              mode === 'edit'
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
            }`}
          >
            {mode === 'edit' ? (
              <>
                <Eye className="h-4 w-4 mr-2" />
                View Mode
              </>
            ) : (
              <>
                <Edit3 className="h-4 w-4 mr-2" />
                Edit Mode
              </>
            )}
          </button>

          <button
            onClick={onExport}
            className="px-3 py-2 border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] rounded-md text-sm font-medium hover:bg-[var(--ff-bg-hover)] flex items-center"
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </button>

          <button
            onClick={onRefresh}
            className="px-3 py-2 border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] rounded-md text-sm font-medium hover:bg-[var(--ff-bg-hover)] flex items-center"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </button>
        </div>
      </div>

      {/* Always-visible search + category filter bar */}
      <div className="flex items-center gap-3">
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search by code or description..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="pl-10 pr-4 py-2 w-full border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md text-sm placeholder:text-[var(--ff-text-tertiary)]"
          />
        </div>

        {/* Category filter */}
        <select
          value={Array.isArray(filters.categories) ? filters.categories[0] || '' : ''}
          onChange={(e) => setFilters({ ...filters, categories: e.target.value ? [e.target.value] : [] })}
          className="px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md text-sm min-w-[160px]"
        >
          <option value="">All Categories</option>
          {filterOptions.categories.map(category => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>

        {/* Advanced filters toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-3 py-2 border rounded-md text-sm font-medium flex items-center whitespace-nowrap ${
            showFilters ? 'bg-blue-600/20 border-blue-500/40 text-blue-400' : 'border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
          }`}
        >
          <Filter className="h-4 w-4 mr-2" />
          More Filters
        </button>
      </div>
    </div>
  );
}
