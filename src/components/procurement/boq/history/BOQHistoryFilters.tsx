/**
 * BOQ History Filters Component
 */

import { Search, Calendar, User } from 'lucide-react';
import { FilterState, INITIAL_FILTERS, CHANGE_TYPE_LABELS } from './BOQHistoryTypes';

interface BOQHistoryFiltersProps {
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
  uniqueUsers: string[];
}

export default function BOQHistoryFilters({
  filters,
  setFilters,
  uniqueUsers
}: BOQHistoryFiltersProps) {
  return (
    <div className="bg-card p-4 rounded-lg border space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search versions..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="pl-10 pr-4 py-2 w-full border border-border rounded-md text-sm"
          />
        </div>

        {/* Change Type */}
        <select
          value={filters.changeType}
          onChange={(e) => setFilters({ ...filters, changeType: e.target.value })}
          className="px-3 py-2 border border-border rounded-md text-sm"
        >
          <option value="">All Changes</option>
          {Object.entries(CHANGE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        {/* Date Range */}
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <select
            value={filters.dateRange}
            onChange={(e) => setFilters({ ...filters, dateRange: e.target.value as FilterState['dateRange'] })}
            className="pl-10 pr-4 py-2 w-full border border-border rounded-md text-sm"
          >
            <option value="all">All Time</option>
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
            <option value="90days">Last 90 Days</option>
          </select>
        </div>

        {/* User Filter */}
        <div className="relative">
          <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <select
            value={filters.user}
            onChange={(e) => setFilters({ ...filters, user: e.target.value })}
            className="pl-10 pr-4 py-2 w-full border border-border rounded-md text-sm"
          >
            <option value="">All Users</option>
            {uniqueUsers.map(user => (
              <option key={user} value={user}>{user}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Clear Filters */}
      {Object.values(filters).some(filter => filter !== '' && filter !== 'all') && (
        <div className="flex justify-end">
          <button
            onClick={() => setFilters(INITIAL_FILTERS)}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}