/**
 * Unified Feed List — channel filter chips + chronological feed items + pagination
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import {
  RefreshCw,
  Rss,
  MessageSquare,
  Mail,
  Bell,
  CheckSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useUnifiedFeed } from '../hooks/useUnifiedFeed';
import { FeedItemRow } from './FeedItemRow';
import type { FeedItem } from '../types/hub.types';

type Channel = 'message' | 'email' | 'notification' | 'meeting';

const CHANNEL_FILTERS: {
  key: Channel | 'all';
  label: string;
  icon: React.ElementType;
}[] = [
  { key: 'all', label: 'All', icon: Rss },
  { key: 'message', label: 'Messages', icon: MessageSquare },
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'notification', label: 'Notifications', icon: Bell },
  { key: 'meeting', label: 'Action Items', icon: CheckSquare },
];

interface UnifiedFeedListProps {
  onOpenThread: (messageId: string) => void;
}

export function UnifiedFeedList({ onOpenThread }: UnifiedFeedListProps) {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<Channel | 'all'>('all');

  const channels = activeFilter === 'all' ? undefined : [activeFilter];
  const { items, isLoading, hasMore, total, counts, refetch, loadMore } =
    useUnifiedFeed(channels);

  const handleItemClick = useCallback(
    (item: FeedItem) => {
      switch (item.channel) {
        case 'message':
          // Open thread within InboxPanel
          if (item.sourceId) {
            onOpenThread(item.sourceId);
          }
          break;
        case 'notification':
          if (item.actionUrl) {
            router.push(item.actionUrl);
          }
          break;
        case 'meeting':
          if (item.actionUrl) {
            router.push(item.actionUrl);
          }
          break;
        case 'email':
          // Switch to email tab
          router.push('/communications?tab=email', undefined, { shallow: true });
          break;
        default:
          break;
      }
    },
    [onOpenThread, router]
  );

  const getCount = (key: Channel | 'all'): number => {
    if (key === 'all') {
      return counts.message + counts.email + counts.notification + counts.meeting;
    }
    return counts[key] || 0;
  };

  return (
    <div className="space-y-4">
      {/* Filter chips + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 flex-wrap">
          {CHANNEL_FILTERS.map(f => {
            const Icon = f.icon;
            const isActive = activeFilter === f.key;
            const count = getCount(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setActiveFilter(f.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  isActive
                    ? 'bg-[var(--ff-primary)]/10 text-[var(--ff-primary)]'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)]'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {f.label}
                {count > 0 && (
                  <span className={cn(
                    'px-1.5 py-0.5 text-[10px] font-semibold rounded-full',
                    isActive
                      ? 'bg-[var(--ff-primary)]/20 text-[var(--ff-primary)]'
                      : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]'
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => refetch()}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* Count summary */}
      <p className="text-xs text-[var(--ff-text-tertiary)]">
        {total > 0 ? `${total} item${total !== 1 ? 's' : ''}` : ''}
      </p>

      {/* Feed items */}
      {isLoading && items.length === 0 ? (
        <LoadingSpinner className="py-12" size="sm" label="Loading feed..." />
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <Rss className="w-10 h-10 mx-auto text-[var(--ff-text-tertiary)] mb-3" />
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {activeFilter === 'all'
              ? 'No activity yet'
              : `No ${CHANNEL_FILTERS.find(f => f.key === activeFilter)?.label.toLowerCase() || 'items'} found`}
          </p>
        </div>
      ) : (
        <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          {items.map(item => (
            <FeedItemRow key={`${item.channel}-${item.id}`} item={item} onClick={handleItemClick} />
          ))}

          {hasMore && (
            <div className="flex justify-center py-3 border-t border-[var(--ff-border-light)]">
              <button
                type="button"
                onClick={loadMore}
                disabled={isLoading}
                className="px-4 py-1.5 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
