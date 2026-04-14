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

import { useState } from 'react';
import { Search, Filter, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProjects } from '@/hooks/useProjects';
import type { TicketFilters as TicketFiltersType } from '../../types/ticket';
import { TicketType } from '../../types/ticket';
import {
  T1_LABELS,
  T1_CATEGORY_MAP,
  SOURCE_LABELS,
  type T1Category,
} from '../../constants/ticketCategories';

/**
 * Maps each T1 category to the underlying TicketType values it represents.
 * Derived from T1_CATEGORY_MAP (inverted).
 */
const T1_TO_TYPES: Record<T1Category, TicketType[]> = (() => {
  const result: Record<string, TicketType[]> = {};
  for (const [type, cat] of Object.entries(T1_CATEGORY_MAP)) {
    if (!result[cat]) result[cat] = [];
    result[cat].push(type as TicketType);
  }
  return result as Record<T1Category, TicketType[]>;
})();

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
  const handleFilterChange = (key: keyof TicketFiltersType, value: TicketFiltersType[keyof TicketFiltersType]) => {
    onFiltersChange({
      ...filters,
      [key]: value || undefined,
    });
  };

  /**
   * Handle T1 category filter — stores t1_category on the filters object
   * and expands to ticket_type array so the API receives concrete type values.
   */
  const handleT1CategoryChange = (cat: string) => {
    if (!cat) {
      // Clear both virtual and expanded filters
      const { t1_category: _t1, ticket_type: _tt, ...rest } = filters;
      onFiltersChange(rest);
      return;
    }
    const types = T1_TO_TYPES[cat as T1Category] ?? [];
    onFiltersChange({
      ...filters,
      t1_category: cat,
      ticket_type: types.length > 0 ? (types as TicketFiltersType['ticket_type']) : undefined,
    });
  };

  // 🟢 WORKING: Clear all filters
  const handleClearFilters = () => {
    onFiltersChange({});
  };

  // 🟢 WORKING: Check if any filters are active
  // Exclude internal pagination keys and ticket_type when t1_category is set
  // (ticket_type is a derived expansion of t1_category — count them as one filter)
  const hasActiveFilters = Object.keys(filters).some((key) => {
    if (key === 'page' || key === 'pageSize') return false;
    if (key === 'ticket_type' && filters.t1_category) return false;
    return filters[key as keyof TicketFiltersType] !== undefined;
  });

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
              {Object.keys(filters).filter((k) => {
                if (k === 'page' || k === 'pageSize') return false;
                if (k === 'ticket_type' && filters.t1_category) return false;
                return !!filters[k as keyof TicketFiltersType];
              }).length}
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
              <option value="handed_to_ops">Handed to Ops</option>
              <option value="in_progress">In Progress</option>
              <option value="open">Open</option>
              <option value="pending_handover">Pending Handover</option>
              <option value="pending_qa">Pending QA</option>
              <option value="qa_approved">QA Approved</option>
              <option value="qa_in_progress">QA In Progress</option>
              <option value="qa_rejected">QA Rejected</option>
              <option value="resolved">Resolved</option>
              <option value="verified">Verified</option>
            </select>
          </div>

          {/* T1 Category Filter */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              Category
            </label>
            <select
              value={filters.t1_category || ''}
              onChange={(e) => handleT1CategoryChange(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="">All Categories</option>
              {(Object.keys(T1_LABELS) as T1Category[]).map((cat) => (
                <option key={cat} value={cat}>
                  {T1_LABELS[cat]}
                </option>
              ))}
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

          {/* Source Filter */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              Source
            </label>
            <select
              value={(filters.source as string) || ''}
              onChange={(e) => handleFilterChange('source', e.target.value)}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="">All Sources</option>
              {Object.entries(SOURCE_LABELS).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
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

          {/* Subcategory Filter (ticket_category) */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              Subcategory
            </label>
            <select
              value={(filters.ticket_category as string) || ''}
              onChange={(e) => handleFilterChange('ticket_category', e.target.value)}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="">All Subcategories</option>
              <optgroup label="Operational">
                <option value="maintenance">Maintenance</option>
                <option value="snag">Snag</option>
                <option value="hse_incident">HSE</option>
                <option value="dev_ops">DevOps</option>
                <option value="sales_lead">Sales Lead</option>
                <option value="unspecified">Unspecified</option>
              </optgroup>
              <optgroup label="PP Data / OLT">
                <option value="pre_provision">Pre-Provision</option>
                <option value="fault_repair">Fault Repair</option>
                <option value="modification">Modification</option>
                <option value="ont_swap">ONT Swap</option>
                <option value="new_installation">New Installation</option>
                <option value="serial_mismatch">Serial Mismatch</option>
                <option value="olt_investigation">OLT Investigation</option>
              </optgroup>
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
