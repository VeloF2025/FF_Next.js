/**
 * CAPA Form - Create/edit corrective action
 */

import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { log } from '@/lib/logger';
import {
  CAPA_SEVERITY_CONFIG,
  type CAPASeverity,
  type CAPASourceType,
} from '@/modules/health-safety/types/capa.types';

interface CAPAFormProps {
  sourceType?: CAPASourceType;
  sourceId?: string;
  projectId?: string;
  contractorId?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

const inputClass =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const labelClass = 'block text-sm font-medium text-[var(--ff-text-primary)] mb-1';

export function CAPAForm({
  sourceType = 'observation',
  sourceId,
  projectId,
  contractorId,
  onSuccess,
  onCancel,
}: CAPAFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    severity: 'medium' as CAPASeverity,
    due_date: '',
    assigned_to: '',
    preventive_actions: '',
  });

  const dialogRef = useRef<HTMLDivElement>(null);

  // Set default due date based on severity
  useEffect(() => {
    const days = CAPA_SEVERITY_CONFIG[form.severity].defaultDueDays;
    const d = new Date();
    d.setDate(d.getDate() + days);
    setForm((prev) => ({ ...prev, due_date: d.toISOString().split('T')[0] ?? '' }));
  }, [form.severity]);

  // Load users for assignment
  useEffect(() => {
    fetch('/api/users?limit=200', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setUsers(d.data || d.users || []))
      .catch((err) => log.error('Failed to load users', err as Error));
  }, []);

  // Focus trap + Escape close
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusableSelectors =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    // Focus first interactive element on mount
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(focusableSelectors)
    ).filter((el) => !el.hasAttribute('disabled'));
    focusable[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;

      const els = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelectors)
      ).filter((el) => !el.hasAttribute('disabled'));

      if (els.length === 0) return;

      const first = els[0]!;
      const last = els[els.length - 1]!;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/health-safety/capa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          source_type: sourceType,
          source_id: sourceId,
          project_id: projectId,
          contractor_id: contractorId,
          title: form.title,
          description: form.description || undefined,
          severity: form.severity,
          due_date: form.due_date,
          assigned_to: form.assigned_to || undefined,
          preventive_actions: form.preventive_actions || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create CAPA');
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create CAPA');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="capa-dialog-title"
        className="bg-[var(--ff-bg-primary)] rounded-xl border border-[var(--ff-border-light)] w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
          <h2 id="capa-dialog-title" className="text-lg font-semibold text-[var(--ff-text-primary)]">
            New Corrective Action
          </h2>
          <button
            onClick={onCancel}
            aria-label="Close dialog"
            className="p-3 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-2 text-sm text-red-400 bg-red-500/10 rounded-lg border border-red-500/30">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="capa_title" className={labelClass}>Title *</label>
            <input
              id="capa_title"
              type="text"
              required
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="What needs to be corrected?"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="capa_desc" className={labelClass}>Description</label>
            <textarea
              id="capa_desc"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Detailed description of the corrective action required..."
              rows={3}
              className={`${inputClass} resize-y`}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="capa_severity" className={labelClass}>Severity</label>
              <select
                id="capa_severity"
                value={form.severity}
                onChange={(e) => setForm((p) => ({ ...p, severity: e.target.value as CAPASeverity }))}
                className={inputClass}
              >
                {Object.entries(CAPA_SEVERITY_CONFIG).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label} ({cfg.defaultDueDays}d)</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="capa_due" className={labelClass}>Due Date *</label>
              <input
                id="capa_due"
                type="date"
                required
                value={form.due_date}
                onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="capa_assign" className={labelClass}>Assign To</label>
            <select
              id="capa_assign"
              value={form.assigned_to}
              onChange={(e) => setForm((p) => ({ ...p, assigned_to: e.target.value }))}
              className={inputClass}
            >
              <option value="">— Unassigned —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="capa_preventive" className={labelClass}>Preventive Actions</label>
            <textarea
              id="capa_preventive"
              value={form.preventive_actions}
              onChange={(e) => setForm((p) => ({ ...p, preventive_actions: e.target.value }))}
              placeholder="What will be done to prevent recurrence?"
              rows={2}
              className={`${inputClass} resize-y`}
            />
          </div>

          <div className="flex items-center gap-3 pt-3 border-t border-[var(--ff-border-light)]">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {submitting ? 'Creating...' : 'Create CAPA'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
