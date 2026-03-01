/**
 * Email compose form for the Communications Hub
 * Simple to/subject/body form that sends via /api/communications/email-send
 */

import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { log } from '@/lib/logger';

interface EmailComposeFormProps {
  onSent: () => void;
}

export function EmailComposeForm({ onSent }: EmailComposeFormProps) {
  const [to, setTo] = useState('');
  const [toName, setToName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to || !subject || !body) return;

    setIsSending(true);
    setStatus(null);

    try {
      const res = await fetch('/api/communications/email-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          to: to.trim(),
          toName: toName.trim() || undefined,
          subject: subject.trim(),
          bodyHtml: `<div style="font-family:sans-serif;font-size:14px;color:#333;">${body.replace(/\n/g, '<br>')}</div>`,
          bodyText: body,
        }),
      });

      const json = await res.json();

      if (json.success) {
        setStatus({ type: 'success', message: 'Email sent successfully' });
        setTo('');
        setToName('');
        setSubject('');
        setBody('');
        onSent();
        setTimeout(() => setStatus(null), 3000);
      } else {
        setStatus({ type: 'error', message: json.error || 'Failed to send email' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error('Email compose failed:', err);
      setStatus({ type: 'error', message: msg });
    } finally {
      setIsSending(false);
    }
  };

  const inputClasses = 'w-full px-3 py-2 text-sm rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50 focus:border-[var(--ff-primary)]';

  return (
    <form onSubmit={handleSend} className="space-y-4">
      {/* To */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
            To (email) *
          </label>
          <input
            type="email"
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="recipient@example.com"
            required
            className={inputClasses}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
            Recipient name
          </label>
          <input
            type="text"
            value={toName}
            onChange={e => setToName(e.target.value)}
            placeholder="John Doe"
            className={inputClasses}
          />
        </div>
      </div>

      {/* Subject */}
      <div>
        <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
          Subject *
        </label>
        <input
          type="text"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Email subject"
          required
          className={inputClasses}
        />
      </div>

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
          rows={8}
          className={cn(inputClasses, 'resize-y min-h-[120px]')}
        />
      </div>

      {/* Status message */}
      {status && (
        <p className={cn(
          'text-sm',
          status.type === 'success' ? 'text-green-500' : 'text-red-500'
        )}>
          {status.message}
        </p>
      )}

      {/* Send button */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSending || !to || !subject || !body}
          className={cn(
            'flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg transition-colors',
            isSending || !to || !subject || !body
              ? 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          )}
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {isSending ? 'Sending...' : 'Send Email'}
        </button>
      </div>
    </form>
  );
}
