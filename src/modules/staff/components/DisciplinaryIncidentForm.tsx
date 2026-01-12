'use client';

import { useState, useEffect } from 'react';
import { X, Calendar, FileText, Upload, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import type { DisciplinaryIncident } from '@/types/staff';
import {
  DISCIPLINARY_TYPE_LABELS,
  DISCIPLINARY_OUTCOME_LABELS,
} from '@/types/staff/disciplinary.types';

interface DisciplinaryIncidentFormProps {
  staffId: string;
  incident?: DisciplinaryIncident | null;
  issuedByOptions?: { id: string; name: string }[];
  onSave: (incident: Partial<DisciplinaryIncident>) => Promise<void>;
  onClose: () => void;
}

export function DisciplinaryIncidentForm({
  staffId,
  incident,
  issuedByOptions = [],
  onSave,
  onClose,
}: DisciplinaryIncidentFormProps) {
  const [formData, setFormData] = useState<{
    incidentDate: string;
    incidentType: string;
    description: string;
    outcome: string;
    issuedBy: string;
    followUpDate: string;
    followUpNotes: string;
    isResolved: boolean;
    resolvedDate: string;
  }>({
    incidentDate: incident?.incidentDate
      ? format(new Date(incident.incidentDate), 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd'),
    incidentType: incident?.incidentType || 'verbal_warning',
    description: incident?.description || '',
    outcome: incident?.outcome || '',
    issuedBy: incident?.issuedBy || '',
    followUpDate: incident?.followUpDate
      ? format(new Date(incident.followUpDate), 'yyyy-MM-dd')
      : '',
    followUpNotes: incident?.followUpNotes || '',
    isResolved: incident?.isResolved || false,
    resolvedDate: incident?.resolvedDate
      ? format(new Date(incident.resolvedDate), 'yyyy-MM-dd')
      : '',
  });
  const [attachments, setAttachments] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState(incident?.attachments || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.description.trim()) {
      setError('Description is required');
      return;
    }

    setSaving(true);
    try {
      const payload: Partial<DisciplinaryIncident> = {
        ...(incident?.id && { id: incident.id }),
        staffId,
        incidentDate: formData.incidentDate,
        incidentType: formData.incidentType as DisciplinaryIncident['incidentType'],
        description: formData.description.trim(),
        outcome: formData.outcome ? formData.outcome as DisciplinaryIncident['outcome'] : undefined,
        issuedBy: formData.issuedBy || undefined,
        followUpDate: formData.followUpDate || undefined,
        followUpNotes: formData.followUpNotes.trim() || undefined,
        isResolved: formData.isResolved,
        resolvedDate: formData.resolvedDate || undefined,
        attachments: existingAttachments,
      };

      await onSave(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save incident');
    } finally {
      setSaving(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAttachments((prev) => [...prev, ...files]);
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const removeExistingAttachment = (index: number) => {
    setExistingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-bg-secondary)] rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            {incident ? 'Edit Disciplinary Incident' : 'Add Disciplinary Incident'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Incident Type and Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Incident Type *
              </label>
              <select
                value={formData.incidentType}
                onChange={(e) => setFormData((prev) => ({ ...prev, incidentType: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Object.entries(DISCIPLINARY_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Incident Date *
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={formData.incidentDate}
                  onChange={(e) => setFormData((prev) => ({ ...prev, incidentDate: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-muted)] pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Description *
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              rows={4}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Describe the incident..."
              required
            />
          </div>

          {/* Outcome and Issued By */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Outcome
              </label>
              <select
                value={formData.outcome}
                onChange={(e) => setFormData((prev) => ({ ...prev, outcome: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Pending</option>
                {Object.entries(DISCIPLINARY_OUTCOME_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Issued By
              </label>
              <select
                value={formData.issuedBy}
                onChange={(e) => setFormData((prev) => ({ ...prev, issuedBy: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select staff member</option>
                {issuedByOptions.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Follow-up Date and Notes */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Follow-up Date
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={formData.followUpDate}
                  onChange={(e) => setFormData((prev) => ({ ...prev, followUpDate: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-muted)] pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Follow-up Notes
              </label>
              <input
                type="text"
                value={formData.followUpNotes}
                onChange={(e) => setFormData((prev) => ({ ...prev, followUpNotes: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Notes for follow-up..."
              />
            </div>
          </div>

          {/* Resolution */}
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <input
                type="checkbox"
                id="isResolved"
                checked={formData.isResolved}
                onChange={(e) => setFormData((prev) => ({ ...prev, isResolved: e.target.checked }))}
                className="w-4 h-4 rounded border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]"
              />
              <label htmlFor="isResolved" className="text-sm font-medium text-[var(--ff-text-primary)]">
                Mark as Resolved
              </label>
            </div>

            {formData.isResolved && (
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Resolution Date
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={formData.resolvedDate}
                    onChange={(e) => setFormData((prev) => ({ ...prev, resolvedDate: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-muted)] pointer-events-none" />
                </div>
              </div>
            )}
          </div>

          {/* Attachments */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              Attachments
            </label>

            {/* Existing Attachments */}
            {existingAttachments.length > 0 && (
              <div className="space-y-2 mb-3">
                {existingAttachments.map((att, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-2 bg-[var(--ff-bg-tertiary)] rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-400" />
                      <a
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-400 hover:text-blue-300"
                      >
                        {att.filename}
                      </a>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeExistingAttachment(i)}
                      className="p-1 text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* New Attachments */}
            {attachments.length > 0 && (
              <div className="space-y-2 mb-3">
                {attachments.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-green-400" />
                      <span className="text-sm text-[var(--ff-text-primary)]">{file.name}</span>
                      <span className="text-xs text-[var(--ff-text-secondary)]">
                        ({(file.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="p-1 text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Upload Button */}
            <label className="inline-flex items-center gap-2 px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-dashed border-[var(--ff-border-light)] rounded-lg cursor-pointer hover:bg-[var(--ff-bg-hover)]">
              <Upload className="w-4 h-4" />
              Add Attachment
              <input
                type="file"
                onChange={handleFileSelect}
                className="hidden"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                multiple
              />
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--ff-border-light)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : incident ? 'Update Incident' : 'Add Incident'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
