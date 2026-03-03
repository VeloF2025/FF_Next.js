'use client';

/**
 * EmailSignatureCard
 * Textarea for composing an email signature with a live plain-text preview.
 * Signature is stored in user_communication_settings.email_signature.
 */

import { Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UserCommunicationSettings } from '@/modules/communications/types/settings.types';

interface EmailSignatureCardProps {
  settings: UserCommunicationSettings;
  onChange: (patch: Partial<UserCommunicationSettings>) => void;
}

const MAX_SIGNATURE_CHARS = 500;

export function EmailSignatureCard({ settings, onChange }: EmailSignatureCardProps) {
  const value = settings.email_signature ?? '';
  const remaining = MAX_SIGNATURE_CHARS - value.length;

  return (
    <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-5">
      {/* Card header */}
      <div className="flex items-center gap-2 mb-4">
        <Mail className="w-4 h-4 text-[var(--ff-text-secondary)]" />
        <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">Email Signature</h3>
      </div>

      <p className="text-xs text-[var(--ff-text-secondary)] mb-3">
        Appended to outgoing emails sent via FibreFlow.
      </p>

      {/* Textarea */}
      <textarea
        value={value}
        onChange={e => {
          if (e.target.value.length <= MAX_SIGNATURE_CHARS) {
            onChange({ email_signature: e.target.value || null });
          }
        }}
        rows={4}
        placeholder="e.g. John Doe&#10;Senior Engineer, Velocity Fibre&#10;+27 82 000 0000"
        className={cn(
          'w-full px-3 py-2 rounded-md border border-[var(--ff-border-light)]',
          'bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] text-sm',
          'placeholder:text-[var(--ff-text-tertiary)] resize-none',
          'focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]'
        )}
      />

      <p
        className={cn(
          'text-xs mt-1 text-right',
          remaining < 50
            ? 'text-amber-500'
            : 'text-[var(--ff-text-tertiary)]'
        )}
      >
        {remaining} characters remaining
      </p>

      {/* Live preview — only when there's content */}
      {value.trim() && (
        <div className="mt-4">
          <p className="text-xs font-medium text-[var(--ff-text-secondary)] mb-2">Preview</p>
          <div
            className={cn(
              'rounded-md border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)]',
              'px-4 py-3 text-sm text-[var(--ff-text-primary)] whitespace-pre-wrap font-mono'
            )}
          >
            {value}
          </div>
        </div>
      )}
    </div>
  );
}
