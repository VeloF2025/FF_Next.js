// ============= Message Filters Component =============
// Filter dropdowns for category, priority, and status

import React from 'react';
import { statusConfig } from '../data/statusConfig';
import { priorityConfig } from '../data/priorityConfig';
import { categoryConfig } from '../data/categoryConfig';

interface MessageFiltersProps {
  categoryFilter: string;
  onCategoryChange: (value: string) => void;
  priorityFilter: string;
  onPriorityChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
}

export const MessageFilters: React.FC<MessageFiltersProps> = ({
  categoryFilter,
  onCategoryChange,
  priorityFilter,
  onPriorityChange,
  statusFilter,
  onStatusChange
}) => {
  return (
    <div className="p-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
      {/* Category Filter */}
      <select
        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm"
        value={categoryFilter}
        onChange={(e) => onCategoryChange(e.target.value)}
      >
        <option value="all">All Categories</option>
        {Object.entries(categoryConfig).map(([key, config]) => (
          <option key={key} value={key}>{config.label}</option>
        ))}
      </select>

      <div className="flex space-x-2">
        {/* Priority Filter */}
        <select
          className="flex-1 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm"
          value={priorityFilter}
          onChange={(e) => onPriorityChange(e.target.value)}
        >
          <option value="all">All Priorities</option>
          {Object.entries(priorityConfig).map(([key, config]) => (
            <option key={key} value={key}>{config.label}</option>
          ))}
        </select>

        {/* Status Filter */}
        <select
          className="flex-1 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          <option value="all">All Status</option>
          {Object.entries(statusConfig).map(([key, config]) => (
            <option key={key} value={key}>{config.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
};
