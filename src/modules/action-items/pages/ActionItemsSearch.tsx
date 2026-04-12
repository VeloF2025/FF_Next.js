'use client';

import { useState } from 'react';
import { Filter, ArrowLeft, Search } from 'lucide-react';
import { useRouter } from 'next/router';
import { ActionItem, ActionItemFilters, ActionItemStatus, ActionItemPriority } from '@/types/action-items.types';
import { actionItemsService } from '@/services/action-items/actionItemsService';
import { ActionItemsList } from '../components/ActionItemsList';
import { Button } from '@/components/ui/button';

export function ActionItemsSearch() {
  const router = useRouter();
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filters, setFilters] = useState<ActionItemFilters>({
    search: '',
    status: undefined,
    priority: undefined,
    assignee_name: '',
  });

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setLoading(true);
      setError(null);

      // Build filters object, excluding empty values
      const activeFilters: ActionItemFilters = {};
      if (filters.search) activeFilters.search = filters.search;
      if (filters.status) activeFilters.status = filters.status;
      if (filters.priority) activeFilters.priority = filters.priority;
      if (filters.assignee_name) activeFilters.assignee_name = filters.assignee_name;

      const data = await actionItemsService.getActionItems(activeFilters);
      setItems(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFilters({
      search: '',
      status: undefined,
      priority: undefined,
      assignee_name: '',
    });
    setItems([]);
    setError(null);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <Button variant="link" onClick={() => { void router.push('/action-items'); }} className="mb-4 pl-0">
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Button>

        <div className="flex items-center gap-3">
          <Filter className="w-8 h-8 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Filter & Search Action Items</h1>
            <p className="text-[var(--ff-text-secondary)] mt-1">Find specific action items</p>
          </div>
        </div>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Search text */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Search description
            </label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              placeholder="Search in descriptions..."
              className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Assignee name
            </label>
            <input
              type="text"
              value={filters.assignee_name}
              onChange={(e) => setFilters({ ...filters, assignee_name: e.target.value })}
              placeholder="Filter by assignee..."
              className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Status
            </label>
            <select
              value={filters.status || ''}
              onChange={(e) => setFilters({ ...filters, status: (e.target.value as ActionItemStatus) || undefined })}
              className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Priority
            </label>
            <select
              value={filters.priority || ''}
              onChange={(e) => setFilters({ ...filters, priority: (e.target.value as ActionItemPriority) || undefined })}
              className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All priorities</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <Button type="submit" variant="primary" size="sm" disabled={loading} loading={loading}>
            <Search className="w-4 h-4" />
            {loading ? 'Searching...' : 'Search'}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={handleReset}>
            Reset
          </Button>
        </div>
      </form>

      {/* Results */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4 mb-6">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="mb-4">
            <p className="text-[var(--ff-text-secondary)]">
              Found <span className="font-semibold">{items.length}</span> action items
            </p>
          </div>
          <ActionItemsList items={items} onItemUpdated={handleSearch} />
        </>
      )}

      {!loading && items.length === 0 && !error && filters.search && (
        <div className="text-center py-12">
          <Search className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
          <p className="text-[var(--ff-text-secondary)]">No action items match your search criteria</p>
        </div>
      )}
    </div>
  );
}
