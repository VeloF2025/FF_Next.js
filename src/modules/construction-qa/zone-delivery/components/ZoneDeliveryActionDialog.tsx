import type { FormEvent, ReactNode } from 'react';
import { useState } from 'react';

export interface AuditedActionValues {
  effectiveAt: string;
  source: string;
  reason?: string;
}
interface Props {
  open: boolean;
  title: string;
  submitting: boolean;
  requireReason?: boolean;
  children?: ReactNode;
  onClose: () => void;
  onSubmit: (values: AuditedActionValues) => Promise<boolean>;
}

export function ZoneDeliveryActionDialog({
  open, title, submitting, requireReason = false, children, onClose, onSubmit,
}: Props) {
  const [effectiveAt, setEffectiveAt] = useState('');
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  if (!open) return null;

  const close = () => {
    setEffectiveAt('');
    setSource('');
    setReason('');
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const succeeded = await onSubmit({
      effectiveAt,
      source: source.trim(),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    if (succeeded) close();
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="zone-action-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <form onSubmit={event => void submit(event)} className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--ff-bg-primary)] p-5">
        <h2 id="zone-action-title" className="text-lg font-semibold text-[var(--ff-text-primary)]">{title}</h2>
        {children}
        <label className="block text-sm text-[var(--ff-text-primary)]">
          Effective date and time
          <input type="datetime-local" required value={effectiveAt} onChange={event => setEffectiveAt(event.target.value)} className="mt-1 w-full rounded border border-[var(--border-color)] bg-transparent px-3 py-2" />
        </label>
        <label className="block text-sm text-[var(--ff-text-primary)]">
          Source
          <input required value={source} onChange={event => setSource(event.target.value)} className="mt-1 w-full rounded border border-[var(--border-color)] bg-transparent px-3 py-2" />
        </label>
        <label className="block text-sm text-[var(--ff-text-primary)]">
          Reason{requireReason ? '' : ' (optional)'}
          <textarea required={requireReason} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded border border-[var(--border-color)] bg-transparent px-3 py-2" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="rounded border border-[var(--border-color)] px-3 py-2 text-sm">Cancel</button>
          <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-60">Submit audited action</button>
        </div>
      </form>
    </div>
  );
}
