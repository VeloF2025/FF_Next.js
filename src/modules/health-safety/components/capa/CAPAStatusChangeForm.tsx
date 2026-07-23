/**
 * CAPA status change control - select next status + optional comment,
 * submits PUT /api/health-safety/capa/[capaId]
 */

import React, { useState } from 'react';
import { log } from '@/lib/logger';
import { CAPA_STATUS_TRANSITIONS, CAPA_STATUS_CONFIG, type CAPAStatus } from '@/modules/health-safety/types/capa.types';

const inputClass =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const labelClass = 'block text-sm font-medium text-[var(--ff-text-primary)] mb-1';

interface CAPAStatusChangeFormProps {
  capaId: string;
  currentStatus: CAPAStatus;
  onSuccess: () => void;
}

export function CAPAStatusChangeForm({ capaId, currentStatus, onSuccess }: CAPAStatusChangeFormProps) {
  const allowed = CAPA_STATUS_TRANSITIONS[currentStatus] || [];
  const [nextStatus, setNextStatus] = useState<CAPAStatus | ''>(allowed[0] || '');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (allowed.length === 0) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <h2 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-2">
          Status
        </h2>
        <p className="text-sm text-[var(--ff-text-tertiary)]">No further status transitions available</p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nextStatus) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/health-safety/capa/${capaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: nextStatus, comment: comment.trim() || undefined }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(err?.error?.message || 'Failed to update status');
      }

      setComment('');
      onSuccess();
    } catch (err) {
      log.error('Failed to update CAPA status', { error: err, capaId });
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <h2 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-4">
        Change Status
      </h2>

      {error && (
        <div className="mb-4 p-2 text-sm text-red-400 bg-red-500/10 rounded-lg border border-red-500/30">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="capa_next_status" className={labelClass}>New Status</label>
          <select
            id="capa_next_status"
            value={nextStatus}
            onChange={(e) => setNextStatus(e.target.value as CAPAStatus)}
            className={inputClass}
          >
            {allowed.map((status) => (
              <option key={status} value={status}>
                {CAPA_STATUS_CONFIG[status]?.label || status}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="capa_status_comment" className={labelClass}>Comment (optional)</label>
          <textarea
            id="capa_status_comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a note about this status change..."
            rows={2}
            className={`${inputClass} resize-y`}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {submitting ? 'Updating...' : 'Update Status'}
        </button>
      </form>
    </div>
  );
}
