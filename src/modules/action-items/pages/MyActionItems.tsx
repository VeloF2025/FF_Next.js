/**
 * My Action Items Page
 * Shows action items assigned to the current user across all modules.
 * Items are grouped by source (meetings, procurement, NOC, etc.)
 */

import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Inbox, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/router';
import { ActionItem, ActionItemSourceType } from '@/types/action-items.types';
import { actionItemsService } from '@/services/action-items/actionItemsService';
import { ActionItemsList } from '../components/ActionItemsList';
import { SourceBadge } from '../components/SourceBadge';
import { log } from '@/lib/logger';

type GroupFilter = 'all' | ActionItemSourceType;

export function MyActionItems() {
  const router = useRouter();
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<GroupFilter>('all');

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await actionItemsService.getMyItems();
      setItems(data);
    } catch (error) {
      log.error('Error fetching my items', { error }, 'MyActionItems');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Group items by source_type
  const sources = items.reduce<Record<string, number>>((acc, item) => {
    const src = item.source_type || 'meeting';
    acc[src] = (acc[src] || 0) + 1;
    return acc;
  }, {});

  const filteredItems = filter === 'all'
    ? items
    : items.filter(i => (i.source_type || 'meeting') === filter);

  const pendingCount = items.filter(i => i.status === 'pending' || i.status === 'in_progress').length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Back to action items"
            onClick={() => router.push('/action-items')}
            className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">My Actions</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {pendingCount > 0
                ? `${pendingCount} pending item${pendingCount !== 1 ? 's' : ''} assigned to you`
                : 'No pending items — you\'re all caught up'}
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Refresh action items"
          onClick={fetchItems}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Source filter pills */}
      {Object.keys(sources).length > 1 && (
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              filter === 'all'
                ? 'bg-[var(--ff-primary)] text-white'
                : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
            }`}
          >
            All ({items.length})
          </button>
          {Object.entries(sources).map(([src, count]) => (
            <button
              type="button"
              key={src}
              onClick={() => setFilter(src as GroupFilter)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                filter === src
                  ? 'bg-[var(--ff-primary)] text-white'
                  : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
              }`}
            >
              <SourceBadge source={src} inline />
              ({count})
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-[var(--ff-text-tertiary)]" />
          <span className="ml-2 text-[var(--ff-text-secondary)]">Loading your action items...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <Inbox className="w-12 h-12 mx-auto text-[var(--ff-text-tertiary)] mb-4" />
          <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">No action items assigned to you</h3>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Action items from meetings, procurement approvals, and NOC tickets will appear here when assigned to you.
          </p>
        </div>
      ) : (
        <ActionItemsList items={filteredItems} onItemUpdated={fetchItems} />
      )}
    </div>
  );
}
