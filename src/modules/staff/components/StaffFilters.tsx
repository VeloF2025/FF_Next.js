/**
 * Staff Filters Component
 */

import { Search } from 'lucide-react';
import type { StaffFilter, Department, StaffStatus, StaffLevel } from '@/types/staff.types';
import { formatLabel } from '@/lib/utils';

interface StaffFiltersProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filter: StaffFilter;
  setFilter: (filter: StaffFilter) => void;
  onSearch: (e: React.FormEvent) => void;
}

const departments = ['Engineering', 'Operations', 'Quality Assurance', 'Administration'];
const statuses = ['active', 'inactive', 'on_leave'];
const levels = ['junior', 'mid', 'senior', 'lead', 'manager'];

export function StaffFilters({
  searchTerm,
  setSearchTerm,
  filter,
  setFilter,
  onSearch
}: StaffFiltersProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] p-4 border-b border-[var(--ff-border-light)]">
      <form onSubmit={onSearch} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* Search */}
          <div className="md:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--ff-text-secondary)]" />
            <input
              type="text"
              placeholder="Search staff..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 w-full bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md focus:ring-blue-500 focus:border-blue-500 placeholder:text-[var(--ff-text-secondary)]"
            />
          </div>

          {/* Department Filter */}
          <select
            value={filter.department?.[0] || ''}
            onChange={(e) => setFilter({ ...filter, department: e.target.value ? [e.target.value as Department] : [] })}
            className="px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Departments</option>
            {departments.map(dept => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={filter.status?.[0] || ''}
            onChange={(e) => setFilter({ ...filter, status: e.target.value ? [e.target.value as StaffStatus] : [] })}
            className="px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Statuses</option>
            {statuses.map(status => (
              <option key={status} value={status}>
                {formatLabel(status)}
              </option>
            ))}
          </select>

          {/* Level Filter */}
          <select
            value={filter.level?.[0] || ''}
            onChange={(e) => setFilter({ ...filter, level: e.target.value ? [e.target.value as StaffLevel] : [] })}
            className="px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Levels</option>
            {levels.map(level => (
              <option key={level} value={level}>
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-between items-center">
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Apply Filters
          </button>

          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setFilter({});
            }}
            className="text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
          >
            Clear all filters
          </button>
        </div>
      </form>
    </div>
  );
}