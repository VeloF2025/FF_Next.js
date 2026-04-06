'use client';

/**
 * Complete Visit Modal
 * Form for marking a site visit as completed with findings and action items.
 */

import { useState } from 'react';
import { X, CheckCircle, Plus, Trash2, AlertCircle } from 'lucide-react';
import { updateSiteVisit } from '@/services/siteVisitsService';
import type { SiteVisitWithDetails } from '@/types/site-visit.types';
import { log } from '@/lib/logger';

// ==================== Props ====================

interface CompleteVisitModalProps {
  visit: SiteVisitWithDetails;
  onSuccess: (visit: SiteVisitWithDetails) => void;
  onCancel: () => void;
}

// ==================== Component ====================

export function CompleteVisitModal({ visit, onSuccess, onCancel }: CompleteVisitModalProps) {
  const [actualDate, setActualDate] = useState(visit.scheduledDate);
  const [findings, setFindings] = useState(visit.findings ?? '');
  const [actionItems, setActionItems] = useState<string[]>(
    visit.actionItems.length > 0 ? visit.actionItems : ['']
  );
  const [notes, setNotes] = useState(visit.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addActionItem = () => setActionItems((prev) => [...prev, '']);
  const removeActionItem = (index: number) =>
    setActionItems((prev) => prev.filter((_, i) => i !== index));
  const updateActionItem = (index: number, value: string) =>
    setActionItems((prev) => prev.map((item, i) => (i === index ? value : item)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!actualDate) {
      setError('Actual date is required.');
      return;
    }

    const filteredActionItems = actionItems.filter((item) => item.trim().length > 0);

    setSubmitting(true);
    try {
      const updated = await updateSiteVisit(visit.id, {
        status: 'completed',
        actualDate,
        findings: findings.trim() || undefined,
        actionItems: filteredActionItems,
        notes: notes.trim() || undefined,
      });
      onSuccess(updated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to complete visit';
      log.error('Error completing site visit', { error: err, visitId: visit.id }, 'CompleteVisitModal');
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--ff-border-light)] sticky top-0 bg-[var(--ff-bg-secondary)] z-10">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-400" />
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Complete Visit</h2>
          </div>
          <button
            onClick={onCancel}
            className="p-2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Visit info */}
          <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-[var(--ff-text-secondary)]">Project:</span>
              <span className="text-[var(--ff-text-primary)] font-medium">{visit.projectName ?? visit.projectId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--ff-text-secondary)]">Scheduled:</span>
              <span className="text-[var(--ff-text-primary)]">{visit.scheduledDate}</span>
            </div>
          </div>

          {/* Actual Date */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Actual Visit Date <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={actualDate}
              onChange={(e) => setActualDate(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>

          {/* Findings */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Findings</label>
            <textarea
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              rows={4}
              placeholder="Describe what was observed during the visit..."
              className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Action Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[var(--ff-text-secondary)]">Action Items</label>
              <button
                type="button"
                onClick={addActionItem}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
              >
                <Plus className="h-3 w-3" />
                Add item
              </button>
            </div>
            <div className="space-y-2">
              {actionItems.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item}
                    onChange={(e) => updateActionItem(index, e.target.value)}
                    placeholder={`Action item ${index + 1}...`}
                    className="flex-1 px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  {actionItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeActionItem(index)}
                      className="p-2 text-[var(--ff-text-tertiary)] hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Additional Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any additional notes..."
              className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving...' : 'Mark Complete'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
