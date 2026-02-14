// ============= Document Filters Component =============
// Search and filter controls for documents

import React from 'react';
import { Search } from 'lucide-react';
import { statusConfig } from '../data/statusConfig';
import { typeConfig } from '../data/typeConfig';

interface DocumentFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  requirementFilter: string;
  onRequirementFilterChange: (value: string) => void;
  resultCount: number;
}

export const DocumentFilters: React.FC<DocumentFiltersProps> = ({
  searchTerm,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
  requirementFilter,
  onRequirementFilterChange,
  resultCount
}) => {
  return (
    <div className="bg-card p-4 rounded-lg border border-border">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search documents..."
            className="w-full pl-10 pr-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        {/* Type Filter */}
        <select
          className="border border-border rounded-md px-3 py-2 text-sm"
          value={typeFilter}
          onChange={(e) => onTypeFilterChange(e.target.value)}
        >
          <option value="all">All Types</option>
          {Object.entries(typeConfig).map(([key, config]) => (
            <option key={key} value={key}>{config.label}</option>
          ))}
        </select>

        {/* Status Filter */}
        <select
          className="border border-border rounded-md px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
        >
          <option value="all">All Status</option>
          {Object.entries(statusConfig).map(([key, config]) => (
            <option key={key} value={key}>{config.label}</option>
          ))}
        </select>

        {/* Requirement Filter */}
        <select
          className="border border-border rounded-md px-3 py-2 text-sm"
          value={requirementFilter}
          onChange={(e) => onRequirementFilterChange(e.target.value)}
        >
          <option value="all">All Documents</option>
          <option value="required">Required Only</option>
          <option value="optional">Optional Only</option>
        </select>

        {/* Result Count */}
        <div className="text-sm text-muted-foreground flex items-center">
          {resultCount} document{resultCount !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
};
