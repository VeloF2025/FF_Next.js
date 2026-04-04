/**
 * Thread view - shows root message + replies with inline reply form
 */

import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Send, RefreshCw, Link as LinkIcon } from 'lucide-react';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';
import { cn } from '@/lib/utils';
import { log } from '@/lib/logger';
import type { ThreadMessage, MessageRecipient } from '../types/messaging.types';

interface MessageThreadProps {
  threadId: string;
  onBack: () => void;
}

interface ThreadData {
  root: ThreadMessage & {
    subject: string | null;
    priority: string;
    context_module: string | null;
    context_url: string | null;
  };
  replies: ThreadMessage[];
  recipients: MessageRecipient[];
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
    + ' ' + d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

export function MessageThread({ threadId, onBack }: MessageThreadProps) {
  const [data, setData] = useState<ThreadData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [replyBody, setReplyBody] = useState('');
  const [isSending, setIsSending] = useState(false);

  const fetchThread = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/communications/messages-thread?threadId=${threadId}`,
        { credentials: 'include' }
      );
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch (err) {
      log.error('Failed to fetch thread:', err);
    } finally {
      setIsLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    fetchThread();
  }, [fetchThread]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyBody.trim() || !data) return;

    setIsSending(true);
    try {
      const recipientIds = data.recipients.map(r => r.id);
      // Also include the original sender if not already a recipient
      if (!recipientIds.includes(data.root.sender_id)) {
        recipientIds.push(data.root.sender_id);
      }

      const res = await fetch('/api/communications/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          recipients: recipientIds,
          body: replyBody.trim(),
          threadId,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setReplyBody('');
        await fetchThread();
      }
    } catch (err) {
      log.error('Failed to send reply:', err);
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading) {
    return (
      <LoadingSpinner className="py-12" size="sm" label="Loading thread..." />
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[var(--ff-text-secondary)]">Message not found</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-2 text-sm text-blue-500 hover:text-blue-400"
        >
          Back to inbox
        </button>
      </div>
    );
  }

  const { root, replies, recipients } = data;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-[var(--ff-border-light)]">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-[var(--ff-text-secondary)]" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] truncate">
            {root.subject || '(No subject)'}
          </h3>
          <p className="text-xs text-[var(--ff-text-tertiary)]">
            {recipients.length} participant{recipients.length !== 1 ? 's' : ''}
            {root.context_module && (
              <span className="ml-2 capitalize">
                <LinkIcon className="w-3 h-3 inline mr-0.5" />
                {root.context_module}
              </span>
            )}
          </p>
        </div>
        {root.context_url && (
          <a
            href={root.context_url}
            className="px-3 py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
          >
            View Context
          </a>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {/* Root message */}
        <MessageBubble
          senderName={root.sender_name}
          body={root.body}
          timestamp={root.created_at}
        />

        {/* Replies */}
        {replies.map(reply => (
          <MessageBubble
            key={reply.id}
            senderName={reply.sender_name}
            body={reply.body}
            timestamp={reply.created_at}
          />
        ))}
      </div>

      {/* Reply form */}
      <form
        onSubmit={handleReply}
        className="flex items-end gap-2 pt-4 border-t border-[var(--ff-border-light)]"
      >
        <textarea
          value={replyBody}
          onChange={e => setReplyBody(e.target.value)}
          placeholder="Type a reply..."
          rows={2}
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50 resize-none"
        />
        <button
          type="submit"
          disabled={isSending || !replyBody.trim()}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
            isSending || !replyBody.trim()
              ? 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          )}
        >
          {isSending ? (
            <InlineSpinner size="sm" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </form>
    </div>
  );
}

function MessageBubble({
  senderName,
  body,
  timestamp,
}: {
  senderName: string;
  body: string;
  timestamp: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-[var(--ff-bg-tertiary)] flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-semibold text-[var(--ff-text-secondary)]">
          {senderName?.charAt(0)?.toUpperCase() || '?'}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--ff-text-primary)]">{senderName}</span>
          <span className="text-xs text-[var(--ff-text-tertiary)]">{formatTimestamp(timestamp)}</span>
        </div>
        <p className="text-sm text-[var(--ff-text-secondary)] mt-1 whitespace-pre-wrap">
          {body}
        </p>
      </div>
    </div>
  );
}
