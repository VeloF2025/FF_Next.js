'use client';

import { useEffect, useState } from 'react';
import { Users, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ActionItem } from '@/types/action-items.types';
import { actionItemsService } from '@/services/action-items/actionItemsService';
import { ActionItemsList } from '../components/ActionItemsList';

export function ActionItemsByAssignee() {
  const router = useRouter();
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Group items by assignee
  const groupedByAssignee = items.reduce((acc, item) => {
    const assignee = item.assignee_name || 'Unassigned';
    if (!acc[assignee]) {
      acc[assignee] = {
        assignee_email: item.assignee_email,
        items: [],
      };
    }
    acc[assignee].items.push(item);
    return acc;
  }, {} as Record<string, { assignee_email?: string; items: ActionItem[] }>);

  const fetchItems = async () => {
    try {
      setLoading(true);
      const data = await actionItemsService.getActionItems();
      setItems(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/action-items')}
          className="flex items-center gap-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        <div className="flex items-center gap-3">
          <Users className="w-8 h-8 text-purple-500" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Action Items by Assignee</h1>
            <p className="text-[var(--ff-text-secondary)] mt-1">Grouped by assigned person</p>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading && (
        <div className="text-center py-12">
          <p className="text-[var(--ff-text-secondary)]">Loading...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4 mb-6">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-8">
          {Object.entries(groupedByAssignee)
            .sort(([a], [b]) => {
              // Unassigned last
              if (a === 'Unassigned') return 1;
              if (b === 'Unassigned') return -1;
              return a.localeCompare(b);
            })
            .map(([assignee, group]) => (
              <div key={assignee}>
                <div className="mb-4 flex items-center gap-3">
                  <Users className="w-6 h-6 text-[var(--ff-text-tertiary)]" />
                  <div>
                    <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">{assignee}</h2>
                    {group.assignee_email && (
                      <p className="text-sm text-[var(--ff-text-secondary)]">{group.assignee_email}</p>
                    )}
                    <p className="text-sm text-[var(--ff-text-secondary)] mt-1">{group.items.length} action items</p>
                  </div>
                </div>
                <ActionItemsList items={group.items} onItemUpdated={fetchItems} />
              </div>
            ))}

          {Object.keys(groupedByAssignee).length === 0 && (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
              <p className="text-[var(--ff-text-secondary)]">No action items found</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
