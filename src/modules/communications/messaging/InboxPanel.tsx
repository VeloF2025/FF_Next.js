/**
 * Inbox Panel — replaces the "Coming Soon" placeholder in the Inbox tab
 * Views: Inbox / Sent / Archived with compose modal and thread view
 */

import { useState } from 'react';
import {
  Inbox,
  Send,
  Archive,
  PenLine,
  CheckCheck,
  RefreshCw,
  Mail,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInternalMessages } from '../hooks/useInternalMessages';
import { MessageListItem } from './MessageListItem';
import { MessageThread } from './MessageThread';
import { ComposeMessageModal } from './ComposeMessageModal';
import type { MessageView } from '../types/messaging.types';

const VIEWS: { key: MessageView; label: string; icon: React.ElementType }[] = [
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'sent', label: 'Sent', icon: Send },
  { key: 'archived', label: 'Archived', icon: Archive },
];

export function InboxPanel() {
  const [view, setView] = useState<MessageView>('inbox');
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);

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
  } = useInternalMessages(view);

  const handleOpenThread = (messageId: string) => {
    // Mark as read when opening
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

  // Thread view
  if (activeThread) {
    return (
      <MessageThread threadId={activeThread} onBack={handleBackFromThread} />
    );
  }

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
                onClick={() => setView(v.key)}
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
          {view === 'inbox' && unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
          )}

          <button
            type="button"
            onClick={() => refetch()}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
          </button>

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

      {/* Message count */}
      <p className="text-xs text-[var(--ff-text-tertiary)]">
        {total > 0
          ? `${total} message${total !== 1 ? 's' : ''}${view === 'inbox' && unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`
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
            {view === 'inbox' ? 'Your inbox is empty' :
             view === 'sent' ? 'No sent messages' :
             'No archived messages'}
          </p>
          {view === 'inbox' && (
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

      {/* Compose modal */}
      <ComposeMessageModal
        isOpen={showCompose}
        onClose={() => setShowCompose(false)}
        onSent={handleMessageSent}
      />
    </div>
  );
}
