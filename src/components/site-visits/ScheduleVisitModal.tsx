'use client';

/**
 * Schedule Visit Modal
 * Form for scheduling a new site visit.
 */

import { useState, useEffect } from 'react';
import { X, CalendarPlus, AlertCircle } from 'lucide-react';
import { scheduleSiteVisit } from '@/services/siteVisitsService';
import { SITE_VISIT_TYPES } from '@/types/site-visit.types';
import type { SiteVisitFormData, SiteVisitWithDetails, SiteVisitType } from '@/types/site-visit.types';
import { log } from '@/lib/logger';

// ==================== Labels ====================

const VISIT_TYPE_LABELS: Record<SiteVisitType, string> = {
  inspection: 'Inspection',
  progress_check: 'Progress Check',
  handover: 'Handover',
  safety_audit: 'Safety Audit',
};

// ==================== Project option type ====================

interface ProjectOption {
  id: string;
  name: string;
  code: string | null;
}

interface ContractorOption {
  id: string;
  name: string;
}

// ==================== Props ====================

interface ScheduleVisitModalProps {
  /** If provided, locks the project selector to this value */
  projectId?: string;
  projectName?: string;
  /** If provided, locks the contractor selector to this value */
  contractorId?: string;
  contractorName?: string;
  /** List of projects available to pick from (when projectId not locked) */
  projects?: ProjectOption[];
  /** List of contractors for the selector */
  contractors?: ContractorOption[];
  onSuccess: (visit: SiteVisitWithDetails) => void;
  onCancel: () => void;
}

// ==================== Component ====================

export function ScheduleVisitModal({
  projectId,
  projectName,
  contractorId,
  contractorName,
  projects = [],
  contractors = [],
  onSuccess,
  onCancel,
}: ScheduleVisitModalProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? '');
  const [selectedContractorId, setSelectedContractorId] = useState(contractorId ?? '');
  const [scheduledDate, setScheduledDate] = useState('');
  const [visitType, setVisitType] = useState<SiteVisitType>('inspection');
  const [inspectorName, setInspectorName] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when modal is re-mounted
  useEffect(() => {
    setSelectedProjectId(projectId ?? '');
    setSelectedContractorId(contractorId ?? '');
    setScheduledDate('');
    setVisitType('inspection');
    setInspectorName('');
    setNotes('');
    setError(null);
  }, [projectId, contractorId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedProjectId) {
      setError('Please select a project.');
      return;
    }
    if (!scheduledDate) {
      setError('Please select a scheduled date.');
      return;
    }
    if (!inspectorName.trim()) {
      setError('Inspector name is required.');
      return;
    }

    const data: SiteVisitFormData = {
      projectId: selectedProjectId,
      contractorId: selectedContractorId || null,
      scheduledDate,
      visitType,
      inspectorName: inspectorName.trim(),
      notes: notes.trim() || undefined,
    };

    setSubmitting(true);
    try {
      const visit = await scheduleSiteVisit(data);
      onSuccess(visit);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to schedule visit';
      log.error('Error scheduling site visit', { error: err }, 'ScheduleVisitModal');
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative w-full max-w-lg mx-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Schedule Site Visit</h2>
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

          {/* Project */}
          {projectId ? (
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Project</label>
              <div className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)]">
                {projectName ?? projectId}
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Project <span className="text-red-400">*</span>
              </label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              >
                <option value="">Select a project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.code ? ` (${p.code})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Contractor */}
          {contractorId ? (
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Contractor</label>
              <div className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)]">
                {contractorName ?? contractorId}
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Contractor (optional)</label>
              <select
                value={selectedContractorId}
                onChange={(e) => setSelectedContractorId(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">No contractor / All contractors</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Scheduled Date */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Scheduled Date <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>

          {/* Visit Type */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Visit Type <span className="text-red-400">*</span>
            </label>
            <select
              value={visitType}
              onChange={(e) => setVisitType(e.target.value as SiteVisitType)}
              className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            >
              {SITE_VISIT_TYPES.map((t) => (
                <option key={t} value={t}>{VISIT_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          {/* Inspector Name */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Inspector Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={inspectorName}
              onChange={(e) => setInspectorName(e.target.value)}
              placeholder="e.g. John Smith"
              className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Additional context or instructions for this visit..."
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
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Scheduling...' : 'Schedule Visit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
