/**
 * BOQ Mapping Filters Component
 */

import { Search, X } from 'lucide-react';
import { FilterState, EXCEPTION_TYPE_LABELS } from './BOQMappingTypes';

interface BOQMappingFiltersProps {
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  totalCount: number;
  filteredCount: number;
}

export default function BOQMappingFilters({
  filters,
  onFilterChange,
  totalCount,
  filteredCount
}: BOQMappingFiltersProps) {
  const handleFilterChange = (key: keyof FilterState, value: string) => {
    onFilterChange({
      ...filters,
      [key]: value
    });
  };

  const clearFilters = () => {
    onFilterChange({
      severity: '',
      status: '',
      exceptionType: '',
      search: ''
    });
  };

  const hasActiveFilters = Object.values(filters).some(value => value !== '');

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
          Filters {filteredCount !== totalCount && `(${filteredCount} of ${totalCount})`}
        </h3>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
          >
            <X className="h-4 w-4 mr-1" />
            Clear filters
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search items..."
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Severity Filter */}
        <select
          value={filters.severity}
          onChange={(e) => handleFilterChange('severity', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">All Severities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        {/* Status Filter */}
        <select
          value={filters.status}
          onChange={(e) => handleFilterChange('status', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
          <option value="ignored">Ignored</option>
        </select>

        {/* Exception Type Filter */}
        <select
          value={filters.exceptionType}
          onChange={(e) => handleFilterChange('exceptionType', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">All Types</option>
          {Object.entries(EXCEPTION_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}