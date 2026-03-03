/**
 * Inbox Panel — unified feed + messaging views
 * Views: Feed (default) | Messages | Sent | Archived
 * Features: compose modal, thread view, search, bulk select + archive
 */

import { useState, useEffect, useRef } from 'react';
import {
  Inbox,
  Send,
  Archive,
  PenLine,
  CheckCheck,
  RefreshCw,
  Mail,
  Rss,
  Search,
  X,
  CheckSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInternalMessages } from '../hooks/useInternalMessages';
import { MessageListItem } from './MessageListItem';
import { MessageThread } from './MessageThread';
import { ComposeMessageModal } from './ComposeMessageModal';
import { UnifiedFeedList } from './UnifiedFeedList';
import type { MessageView } from '../types/messaging.types';

type PanelView = 'feed' | MessageView;

const VIEWS: { key: PanelView; label: string; icon: React.ElementType }[] = [
  { key: 'feed', label: 'Feed', icon: Rss },
  { key: 'inbox', label: 'Messages', icon: Inbox },
  { key: 'sent', label: 'Sent', icon: Send },
  { key: 'archived', label: 'Archived', icon: Archive },
];

/** Views that support search and bulk actions */
const SEARCHABLE_VIEWS: PanelView[] = ['inbox', 'sent', 'archived'];

const SEARCH_DEBOUNCE_MS = 300;

export function InboxPanel() {
  const [view, setView] = useState<PanelView>('feed');
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);

  // Search state
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Bulk selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Messages hook — only needed for messaging views, pass 'inbox' when on feed
  const messageView: MessageView = view === 'feed' ? 'inbox' : view;
  const {
    messages,
    isLoading,
    hasMore,
    total,
    unreadCount,
    refetch,
    loadMore,
    markRead,
    markAllRead,
    archiveMessages,
  } = useInternalMessages(messageView, debouncedSearch || undefined);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  // Reset search and selection when switching views
  const handleViewChange = (next: PanelView) => {
    setView(next);
    setSearchInput('');
    setDebouncedSearch('');
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleToggleSelectionMode = () => {
    setSelectionMode(prev => !prev);
    setSelectedIds(new Set());
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleArchiveSelected = async () => {
    if (selectedIds.size === 0) return;
    await archiveMessages(Array.from(selectedIds));
    setSelectedIds(new Set());
    setSelectionMode(false);
  };

  const handleMarkSelectedRead = async () => {
    if (selectedIds.size === 0) return;
    await markRead(Array.from(selectedIds));
    setSelectedIds(new Set());
    setSelectionMode(false);
  };

  const handleOpenThread = (messageId: string) => {
    if (selectionMode) return; // ignore clicks in selection mode (handled by toggle)
    if (view === 'feed') {
      setView('inbox');
    }
    const msg = messages.find(m => m.id === messageId);
    if (msg && !msg.is_read) {
      markRead([messageId]);
    }
    setActiveThread(messageId);
  };

  const handleBackFromThread = () => {
    setActiveThread(null);
    refetch();
  };

  const handleMessageSent = () => {
    refetch();
  };

  // Thread view (shared between feed and messages)
  if (activeThread) {
    return (
      <MessageThread threadId={activeThread} onBack={handleBackFromThread} />
    );
  }

  const isFeed = view === 'feed';
  const isSearchable = SEARCHABLE_VIEWS.includes(view);

  return (
    <div className="space-y-4">
      {/* Top bar: view toggle + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {VIEWS.map(v => {
            const Icon = v.icon;
            const isActive = view === v.key;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => handleViewChange(v.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  isActive
                    ? 'bg-[var(--ff-primary)]/10 text-[var(--ff-primary)]'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)]'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {v.label}
                {v.key === 'inbox' && unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-500 text-white rounded-full">
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {view === 'inbox' && unreadCount > 0 && !selectionMode && (
            <button
              type="button"
              onClick={markAllRead}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
          )}

          {!isFeed && (
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowCompose(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <PenLine className="w-3.5 h-3.5" />
            Compose
          </button>
        </div>
      </div>

      {/* Feed view */}
      {isFeed ? (
        <UnifiedFeedList onOpenThread={handleOpenThread} />
      ) : (
        <>
          {/* Search + bulk action toolbar */}
          {isSearchable && (
            <div className="flex items-center gap-2">
              {/* Search input */}
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--ff-text-tertiary)] pointer-events-none" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  placeholder={`Search ${view}...`}
                  className="w-full pl-8 pr-8 py-1.5 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => setSearchInput('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Select toggle */}
              <button
                type="button"
                onClick={handleToggleSelectionMode}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap',
                  selectionMode
                    ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                    : 'border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)]'
                )}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                {selectionMode ? 'Cancel' : 'Select'}
              </button>
            </div>
          )}

          {/* Bulk action bar — shown when in selection mode with items selected */}
          {selectionMode && selectedIds.size > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/8 border border-blue-500/20 rounded-lg">
              <span className="text-xs text-blue-400 font-medium flex-1">
                {selectedIds.size} selected
              </span>
              {view === 'inbox' && (
                <button
                  type="button"
                  onClick={handleMarkSelectedRead}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Mark read
                </button>
              )}
              {view !== 'archived' && (
                <button
                  type="button"
                  onClick={handleArchiveSelected}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                >
                  <Archive className="w-3.5 h-3.5" />
                  Archive selected
                </button>
              )}
            </div>
          )}

          {/* Message count */}
          <p className="text-xs text-[var(--ff-text-tertiary)]">
            {total > 0
              ? `${total} message${total !== 1 ? 's' : ''}${view === 'inbox' && unreadCount > 0 && !debouncedSearch ? ` (${unreadCount} unread)` : ''}`
              : debouncedSearch
              ? `No results for "${debouncedSearch}"`
              : ''}
          </p>

          {/* Message list */}
          {isLoading && messages.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-5 h-5 animate-spin text-[var(--ff-text-tertiary)]" />
              <span className="ml-2 text-sm text-[var(--ff-text-secondary)]">Loading messages...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12">
              <Mail className="w-10 h-10 mx-auto text-[var(--ff-text-tertiary)] mb-3" />
              <p className="text-sm text-[var(--ff-text-secondary)]">
                {debouncedSearch
                  ? `No messages matching "${debouncedSearch}"`
                  : view === 'inbox'
                  ? 'Your inbox is empty'
                  : view === 'sent'
                  ? 'No sent messages'
                  : 'No archived messages'}
              </p>
              {view === 'inbox' && !debouncedSearch && (
                <button
                  type="button"
                  onClick={() => setShowCompose(true)}
                  className="mt-3 text-sm text-blue-500 hover:text-blue-400"
                >
                  Send your first message
                </button>
              )}
            </div>
          ) : (
            <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
              {messages.map(msg => (
                <MessageListItem
                  key={msg.id}
                  message={msg}
                  onClick={handleOpenThread}
                  showSender={view !== 'sent'}
                  showCheckbox={selectionMode}
                  isSelected={selectedIds.has(msg.id)}
                  onToggleSelect={handleToggleSelect}
                />
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
        </>
      )}

      {/* Compose modal */}
      <ComposeMessageModal
        isOpen={showCompose}
        onClose={() => setShowCompose(false)}
        onSent={handleMessageSent}
      />
    </div>
  );
}
