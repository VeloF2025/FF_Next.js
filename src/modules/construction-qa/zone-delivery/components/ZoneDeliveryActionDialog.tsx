import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

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

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function ZoneDeliveryActionDialog({
  open, title, submitting, requireReason = false, children, onClose, onSubmit,
}: Props) {
  const [effectiveAt, setEffectiveAt] = useState('');
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setEffectiveAt('');
    setSource('');
    setReason('');
    onClose();
  }, [onClose]);

  useEffect(() => {
    let frame: number | undefined;
    if (open) {
      triggerRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      frame = requestAnimationFrame(() => {
        const dialog = dialogRef.current;
        const first = dialog?.querySelector<HTMLElement>(FOCUSABLE);
        (first ?? dialog)?.focus();
      });
    } else if (triggerRef.current) {
      const trigger = triggerRef.current;
      triggerRef.current = null;
      frame = requestAnimationFrame(() => trigger.focus());
    }
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [open]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    ).filter(element => !element.closest('[aria-hidden="true"]'));
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [close]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const succeeded = await onSubmit({
      effectiveAt,
      source: source.trim(),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    if (succeeded) close();
  };
  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="zone-action-title"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
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
