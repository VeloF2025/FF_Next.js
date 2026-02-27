/**
 * BOQ Viewer Filters Component
 */

import { Search, Settings } from 'lucide-react';
import { FilterState, VisibleColumns, INITIAL_FILTERS } from './BOQViewerTypes';
import { BOQItemMappingStatusType, ProcurementStatusType } from '@/types/procurement/boq.types';

interface BOQViewerFiltersProps {
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
  filterOptions: {
    phases: string[];
    categories: string[];
  };
  visibleColumns: VisibleColumns;
  setVisibleColumns: (columns: VisibleColumns) => void;
}

export default function BOQViewerFilters({
  filters,
  setFilters,
  filterOptions,
  visibleColumns,
  setVisibleColumns
}: BOQViewerFiltersProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)] space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Search */}
        <div className="md:col-span-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
            <input
              type="text"
              placeholder="Search items..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="pl-10 pr-4 py-2 w-full border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md text-sm"
            />
          </div>
        </div>

        {/* Mapping Status */}
        <select
          value={filters.mappingStatus}
          onChange={(e) => setFilters({ ...filters, mappingStatus: e.target.value as BOQItemMappingStatusType | '' })}
          className="px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md text-sm"
        >
          <option value="">All Mapping Status</option>
          <option value="pending">Pending</option>
          <option value="mapped">Mapped</option>
          <option value="manual">Manual</option>
          <option value="exception">Exception</option>
        </select>

        {/* Procurement Status */}
        <select
          value={filters.procurementStatus}
          onChange={(e) => setFilters({ ...filters, procurementStatus: e.target.value as ProcurementStatusType | '' })}
          className="px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md text-sm"
        >
          <option value="">All Procurement Status</option>
          <option value="pending">Pending</option>
          <option value="rfq_created">RFQ Created</option>
          <option value="quoted">Quoted</option>
          <option value="awarded">Awarded</option>
          <option value="ordered">Ordered</option>
        </select>

        {/* Phase */}
        <select
          value={filters.phase}
          onChange={(e) => setFilters({ ...filters, phase: e.target.value })}
          className="px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md text-sm"
        >
          <option value="">All Phases</option>
          {filterOptions.phases.map(phase => (
            <option key={phase} value={phase}>{phase}</option>
          ))}
        </select>

        {/* Category Multi-Select */}
        <div className="md:col-span-1">
          <div className="relative group">
            <button className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md text-sm text-left">
              {filters.categories.length === 0 
                ? 'All Categories' 
                : `${filters.categories.length} selected`}
            </button>
            <div className="absolute left-0 right-0 mt-1 bg-[var(--ff-bg-secondary)] rounded-md shadow-lg border border-[var(--ff-border-light)] hidden group-hover:block z-10 max-h-64 overflow-y-auto">
              {filterOptions.categories.map(category => (
                <label key={category} className="flex items-center px-3 py-2 hover:bg-[var(--ff-bg-hover)]">
                  <input
                    type="checkbox"
                    checked={filters.categories.includes(category)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFilters({ ...filters, categories: [...filters.categories, category] });
                      } else {
                        setFilters({ ...filters, categories: filters.categories.filter(c => c !== category) });
                      }
                    }}
                    className="rounded"
                  />
                  <span className="ml-2 text-sm text-[var(--ff-text-secondary)]">{category}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={filters.hasIssues === true}
              onChange={(e) => setFilters({
                ...filters,
                hasIssues: e.target.checked ? true : null
              })}
              className="rounded"
            />
            <span className="ml-2 text-sm text-[var(--ff-text-secondary)]">Show only items with issues</span>
          </label>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setFilters(INITIAL_FILTERS)}
            className="px-3 py-1 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
          >
            Clear Filters
          </button>

          {/* Column Settings */}
          <div className="relative group">
            <button className="p-2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]">
              <Settings className="h-4 w-4" />
            </button>

            <div className="absolute right-0 mt-2 w-56 bg-[var(--ff-bg-secondary)] rounded-md shadow-lg border border-[var(--ff-border-light)] hidden group-hover:block z-10">
              <div className="p-2">
                <div className="text-xs font-semibold text-[var(--ff-text-secondary)] px-2 py-1">Visible Columns</div>
                {Object.keys(visibleColumns).map(key => (
                  <label key={key} className="flex items-center px-2 py-1 hover:bg-[var(--ff-bg-hover)]">
                    <input
                      type="checkbox"
                      checked={visibleColumns[key as keyof VisibleColumns]}
                      onChange={(e) => setVisibleColumns({
                        ...visibleColumns,
                        [key]: e.target.checked
                      })}
                      className="rounded"
                    />
                    <span className="ml-2 text-sm text-[var(--ff-text-secondary)]">
                      {key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}