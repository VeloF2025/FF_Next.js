'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/router';
import { ActionItem } from '@/types/action-items.types';
import { actionItemsService } from '@/services/action-items/actionItemsService';
import { ActionItemsList } from '../components/ActionItemsList';
import { Button } from '@/components/ui/button';

export function OverdueActionItems() {
  const router = useRouter();
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = async () => {
    try {
      setLoading(true);
      const data = await actionItemsService.getActionItems({ overdue: true });
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
        <Button variant="link" onClick={() => { void router.push('/action-items'); }} className="mb-4 pl-0">
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Button>

        <div className="flex items-center gap-3">
          <AlertCircle className="w-8 h-8 text-red-500" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Overdue Action Items</h1>
            <p className="text-[var(--ff-text-secondary)] mt-1">Items past their due date</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4 mb-6">
        <p className="text-red-400">
          <span className="font-semibold">{items.length}</span> overdue action items requiring
          immediate attention
        </p>
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

      {!loading && !error && <ActionItemsList items={items} onItemUpdated={fetchItems} />}
    </div>
  );
}
