/**
 * TicketFilters Component - Ticket filtering interface
 *
 * 🟢 WORKING: Production-ready ticket filters component
 *
 * Features:
 * - Filter by status, type, priority, assignee
 * - Search by ticket UID, DR number, or description
 * - QA ready filter
 * - SLA breach filter
 * - Clear filters option
 * - Responsive layout
 */

'use client';

import React, { useState } from 'react';
import { Search, Filter, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProjects } from '@/hooks/useProjects';
import type { TicketFilters as TicketFiltersType } from '../../types/ticket';

interface TicketFiltersProps {
  /** Current filters */
  filters: TicketFiltersType;
  /** Callback when filters change */
  onFiltersChange: (filters: TicketFiltersType) => void;
  /** Show compact version */
  compact?: boolean;
}

/**
 * 🟢 WORKING: Ticket filters component
 */
export function TicketFilters({ filters, onFiltersChange, compact = false }: TicketFiltersProps) {
  const [showFilters, setShowFilters] = useState(false);
  const { data: projects = [] } = useProjects();
  const activeProjects = (projects as { id: string; name: string; code?: string; status?: string }[])
    .filter((p) => p.status === 'active' || p.status === 'in_progress')
    .sort((a, b) => a.name.localeCompare(b.name));

  // 🟢 WORKING: Handle filter change
  const handleFilterChange = (key: keyof TicketFiltersType, value: any) => {
    onFiltersChange({
      ...filters,
      [key]: value || undefined,
    });
  };

  // 🟢 WORKING: Clear all filters
  const handleClearFilters = () => {
    onFiltersChange({});
  };

  // 🟢 WORKING: Check if any filters are active
  const hasActiveFilters = Object.keys(filters).some(
    (key) => key !== 'page' && key !== 'pageSize' && filters[key as keyof TicketFiltersType] !== undefined
  );

  return (
    <div className="space-y-4">
      {/* Search and Toggle */}
      <div className="flex items-center gap-3">
        {/* Search Input */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search tickets..."
            value={filters.search || ''}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
        </div>

        {/* Filter Toggle */}
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors',
            showFilters
              ? 'bg-blue-500/20 border-blue-500/30 text-blue-400'
              : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)]'
          )}
        >
          <Filter className="w-4 h-4" />
          {!compact && <span>Filters</span>}
          {hasActiveFilters && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-xs font-medium">
              {Object.keys(filters).filter(k => k !== 'page' && k !== 'pageSize' && filters[k as keyof TicketFiltersType]).length}
            </span>
          )}
        </button>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearFilters}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            aria-label="Clear all filters"
          >
            <X className="w-4 h-4" />
            {!compact && <span>Clear</span>}
          </button>
        )}
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className={cn(
          'grid gap-4 p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg',
          compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
        )}>
          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              Status
            </label>
            <select
              value={filters.status || ''}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="">All Statuses</option>
              <option value="assigned">Assigned</option>
              <option value="cancelled">Cancelled</option>
              <option value="closed">Closed</option>
              <option value="handed_to_maintenance">Handed to Maintenance</option>
              <option value="in_progress">In Progress</option>
              <option value="open">Open</option>
              <option value="pending_handover">Pending Handover</option>
              <option value="pending_qa">Pending QA</option>
              <option value="qa_approved">QA Approved</option>
              <option value="qa_in_progress">QA In Progress</option>
              <option value="qa_rejected">QA Rejected</option>
            </select>
          </div>

          {/* Type Filter */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              Type
            </label>
            <select
              value={filters.ticket_type || ''}
              onChange={(e) => handleFilterChange('ticket_type', e.target.value)}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="">All Types</option>
              <option value="incident">Incident</option>
              <option value="maintenance">Maintenance</option>
              <option value="modification">Modification</option>
              <option value="new_installation">New Installation</option>
              <option value="ont_swap">ONT Swap</option>
            </select>
          </div>

          {/* Priority Filter */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              Priority
            </label>
            <select
              value={filters.priority || ''}
              onChange={(e) => handleFilterChange('priority', e.target.value)}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="">All Priorities</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          {/* QA Ready Filter */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              QA Status
            </label>
            <select
              value={filters.qa_ready === undefined ? '' : filters.qa_ready ? 'true' : 'false'}
              onChange={(e) =>
                handleFilterChange('qa_ready', e.target.value === '' ? undefined : e.target.value === 'true')
              }
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="">All</option>
              <option value="true">QA Ready</option>
              <option value="false">Not QA Ready</option>
            </select>
          </div>

          {/* SLA Breach Filter */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              SLA Status
            </label>
            <select
              value={filters.sla_breached === undefined ? '' : filters.sla_breached ? 'true' : 'false'}
              onChange={(e) =>
                handleFilterChange('sla_breached', e.target.value === '' ? undefined : e.target.value === 'true')
              }
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="">All</option>
              <option value="true">SLA Breached</option>
              <option value="false">Within SLA</option>
            </select>
          </div>

          {/* DR Number Filter */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              DR Number
            </label>
            <input
              type="text"
              placeholder="e.g., DR12345"
              value={filters.dr_number || ''}
              onChange={(e) => handleFilterChange('dr_number', e.target.value)}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>

          {/* Project Filter */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              Project
            </label>
            <select
              value={filters.project_id || ''}
              onChange={(e) => handleFilterChange('project_id', e.target.value)}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="">All Projects</option>
              {activeProjects.map((project: { id: string; name: string; code?: string }) => (
                <option key={project.id} value={project.id}>
                  {project.code ? `${project.code} — ${project.name}` : project.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
