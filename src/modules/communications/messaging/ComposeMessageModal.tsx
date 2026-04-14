/**
 * Compose Message Modal
 * Send a new internal message to one or more recipients
 */

import { useState } from 'react';
import { X, Send } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { cn } from '@/lib/utils';
import { log } from '@/lib/logger';
import { RecipientPicker } from './RecipientPicker';
import type { UserOption, MessagePriority } from '../types/messaging.types';

interface ComposeMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSent: () => void;
  threadId?: string;
  defaultSubject?: string;
}

const PRIORITY_OPTIONS: { value: MessagePriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'text-gray-400' },
  { value: 'normal', label: 'Normal', color: 'text-blue-400' },
  { value: 'high', label: 'High', color: 'text-orange-400' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-400' },
];

export function ComposeMessageModal({
  isOpen,
  onClose,
  onSent,
  threadId,
  defaultSubject,
}: ComposeMessageModalProps) {
  const [recipients, setRecipients] = useState<UserOption[]>([]);
  const [subject, setSubject] = useState(defaultSubject || '');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<MessagePriority>('normal');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const canSend = recipients.length > 0 && body.trim().length > 0;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;

    setIsSending(true);
    setError(null);

    try {
      const res = await fetch('/api/communications/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          recipients: recipients.map(r => r.id),
          subject: subject.trim() || undefined,
          body: body.trim(),
          priority,
          threadId: threadId || undefined,
        }),
      });

      const json = await res.json();

      if (json.success) {
        setRecipients([]);
        setSubject('');
        setBody('');
        setPriority('normal');
        onSent();
        onClose();
      } else {
        setError(json.error?.message || 'Failed to send message');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error('Compose message failed:', { error: err });
      setError(msg);
    } finally {
      setIsSending(false);
    }
  };

  const inputClasses =
    'w-full px-3 py-2 text-sm rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50 focus:border-[var(--ff-primary)]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--ff-border-light)] p-4">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            {threadId ? 'Reply' : 'New Message'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--ff-bg-tertiary)] transition-colors"
          >
            <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </button>
        </div>

        <form onSubmit={handleSend} className="p-4 space-y-4">
          {/* Recipients */}
          {!threadId && (
            <div>
              <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                To *
              </label>
              <RecipientPicker selected={recipients} onChange={setRecipients} />
            </div>
          )}

          {/* Subject */}
          {!threadId && (
            <div>
              <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                Subject
              </label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Message subject (optional)"
                className={inputClasses}
              />
            </div>
          )}

          {/* Priority */}
          {!threadId && (
            <div>
              <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                Priority
              </label>
              <div className="flex gap-2">
                {PRIORITY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPriority(opt.value)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                      priority === opt.value
                        ? 'border-[var(--ff-primary)] bg-[var(--ff-primary)]/10 text-[var(--ff-primary)]'
                        : 'border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)]'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Body */}
          <div>
            <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
              Message *
            </label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Type your message..."
              required
              rows={6}
              className={cn(inputClasses, 'resize-y min-h-[100px]')}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2 border-t border-[var(--ff-border-light)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSending || !canSend}
              className={cn(
                'flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-colors',
                isSending || !canSend
                  ? 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              )}
            >
              {isSending ? (
                <InlineSpinner size="sm" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
