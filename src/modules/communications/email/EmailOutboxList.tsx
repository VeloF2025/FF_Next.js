/**
 * Email outbox list — table of sent emails
 */

import { RefreshCw, Mail, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { cn } from '@/lib/utils';
import type { EmailOutboxItem, EmailStatus } from '../types/email.types';
import { useEmailOutbox } from '../hooks/useEmailOutbox';

const STATUS_CONFIG: Record<EmailStatus, { icon: React.ElementType; color: string; label: string }> = {
  queued: { icon: Clock, color: 'text-gray-400', label: 'Queued' },
  sending: { icon: RefreshCw, color: 'text-blue-400', label: 'Sending' },
  sent: { icon: CheckCircle, color: 'text-green-400', label: 'Sent' },
  delivered: { icon: CheckCircle, color: 'text-green-500', label: 'Delivered' },
  failed: { icon: XCircle, color: 'text-red-400', label: 'Failed' },
  bounced: { icon: AlertTriangle, color: 'text-amber-400', label: 'Bounced' },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

export function EmailOutboxList() {
  const { emails, isLoading, hasMore, total, refetch, loadMore } = useEmailOutbox();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--ff-text-secondary)]">
          {total > 0 ? `${total} email${total !== 1 ? 's' : ''} sent` : 'No emails sent yet'}
        </p>
        <button
          type="button"
          onClick={refetch}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Table */}
      {isLoading && emails.length === 0 ? (
        <LoadingSpinner className="py-12" size="sm" label="Loading..." />
      ) : emails.length === 0 ? (
        <div className="text-center py-12">
          <Mail className="w-10 h-10 mx-auto text-[var(--ff-text-tertiary)] mb-3" />
          <p className="text-sm text-[var(--ff-text-secondary)]">No emails sent yet</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            Compose an email using the form above, or emails sent by the system will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--ff-border-light)]">
                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--ff-text-tertiary)]">Status</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--ff-text-tertiary)]">To</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--ff-text-tertiary)]">Subject</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--ff-text-tertiary)]">Source</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--ff-text-tertiary)]">Date</th>
              </tr>
            </thead>
            <tbody>
              {emails.map(email => {
                const cfg = STATUS_CONFIG[email.status] || STATUS_CONFIG.queued;
                const StatusIcon = cfg.icon;
                return (
                  <tr
                    key={email.id}
                    className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                  >
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <StatusIcon className={cn('w-4 h-4', cfg.color)} />
                        <span className={cn('text-xs', cfg.color)}>{cfg.label}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div>
                        <span className="text-[var(--ff-text-primary)]">
                          {email.recipient_name || email.recipient_email}
                        </span>
                        {email.recipient_name && (
                          <span className="text-xs text-[var(--ff-text-tertiary)] ml-1">
                            ({email.recipient_email})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 max-w-[300px]">
                      <span className="text-[var(--ff-text-primary)] truncate block">
                        {email.subject}
                      </span>
                      {email.error_message && (
                        <span className="text-xs text-red-400 truncate block">
                          {email.error_message}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-xs text-[var(--ff-text-tertiary)] capitalize">
                        {email.source_module}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="text-xs text-[var(--ff-text-tertiary)]">
                        {formatDate(email.sent_at || email.created_at)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {hasMore && (
            <div className="flex justify-center pt-4">
              <button
                type="button"
                onClick={loadMore}
                disabled={isLoading}
                className="px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50"
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
