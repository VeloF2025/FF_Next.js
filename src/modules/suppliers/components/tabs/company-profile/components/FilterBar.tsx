// ============= Filter Bar Component =============
// Search, filters, and view mode controls

import React from 'react';
import { Search, Filter, Grid, List, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ViewMode } from '../types/company-profile.types';

interface FilterBarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (value: string) => void;
  categories: string[];
  resultCount: number;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onAddSupplier?: () => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  categories,
  resultCount,
  viewMode,
  onViewModeChange,
  onAddSupplier
}) => {
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Company Profile Directory</h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Browse and manage supplier profiles. Select a supplier to filter other tabs.
          </p>
        </div>
        {onAddSupplier && (
          <button
            onClick={onAddSupplier}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add Supplier</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between space-x-4">
          <div className="flex items-center space-x-4 flex-1">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search suppliers..."
                className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </div>

            {/* Status Filter */}
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <select
                className="border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm"
                value={statusFilter}
                onChange={(e) => onStatusFilterChange(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="pending">Pending</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>

            {/* Category Filter */}
            <select
              className="border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm"
              value={categoryFilter}
              onChange={(e) => onCategoryFilterChange(e.target.value)}
            >
              <option value="all">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {/* View Controls */}
          <div className="flex items-center space-x-2">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {resultCount} suppliers
            </div>
            <div className="flex border border-gray-300 dark:border-gray-600 rounded-md">
              <button
                className={cn(
                  "px-3 py-2 text-sm",
                  viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-700 dark:text-gray-300'
                )}
                onClick={() => onViewModeChange('grid')}
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                className={cn(
                  "px-3 py-2 text-sm",
                  viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-700 dark:text-gray-300'
                )}
                onClick={() => onViewModeChange('list')}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
