/**
 * Add Approval Modal Component
 * Modal for adding a new approval to a pipeline project
 */

import { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Loader2,
  CheckCircle,
  Building2,
  FileText,
} from 'lucide-react';
import type { ServiceAuthority } from '../types';
import { AuthorityPicker } from './AuthorityPicker';

interface ApprovalType {
  id: string;
  name: string;
  code: string;
  category: string | null;
  is_compulsory: boolean;
  condition_type: 'rural_only' | 'urban_only' | null;
}

interface AddApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  projectId: string;
  province?: string;
  municipality?: string;
}

export function AddApprovalModal({
  isOpen,
  onClose,
  onSuccess,
  projectId,
  province,
  municipality,
}: AddApprovalModalProps) {
  const [approvalTypes, setApprovalTypes] = useState<ApprovalType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [selectedType, setSelectedType] = useState<ApprovalType | null>(null);
  const [selectedAuthority, setSelectedAuthority] = useState<ServiceAuthority | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load approval types
  useEffect(() => {
    if (isOpen) {
      loadApprovalTypes();
    }
  }, [isOpen]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedType(null);
      setSelectedAuthority(null);
      setNotes('');
      setError(null);
    }
  }, [isOpen]);

  const loadApprovalTypes = async () => {
    setLoadingTypes(true);
    try {
      const response = await fetch('/api/pipeline/approval-types');
      if (!response.ok) throw new Error('Failed to load approval types');
      const data = await response.json();
      if (data.success) {
        setApprovalTypes(data.data || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approval types');
    } finally {
      setLoadingTypes(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedType) {
      setError('Please select an approval type');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        approval_type_id: selectedType.id,
        notes: notes || undefined,
      };

      // Add authority details if selected
      if (selectedAuthority) {
        body.service_authority_id = selectedAuthority.id;
        body.authority_name = selectedAuthority.authority_name;
        body.authority_contact_name = selectedAuthority.contact_name;
        body.authority_contact_email = selectedAuthority.contact_email;
        body.authority_contact_phone = selectedAuthority.contact_phone;
        body.authority_address = selectedAuthority.physical_address;
      }

      const response = await fetch(`/api/pipeline/projects/${projectId}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to add approval');
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add approval');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  // Group approval types by category
  const groupedTypes = approvalTypes.reduce((acc, type) => {
    const category = type.category || 'Other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(type);
    return acc;
  }, {} as Record<string, ApprovalType[]>);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--ff-bg-primary)] rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)]">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
            <Plus className="w-5 h-5 text-[var(--ff-accent)]" />
            Add Approval
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--ff-bg-secondary)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {loadingTypes ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-text-secondary)]" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Approval Type Selection */}
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  Approval Type <span className="text-red-500">*</span>
                </label>
                <div className="space-y-4 max-h-60 overflow-y-auto border border-[var(--ff-border-light)] rounded-lg p-3">
                  {Object.entries(groupedTypes).map(([category, types]) => (
                    <div key={category}>
                      <h3 className="text-xs font-semibold text-[var(--ff-text-secondary)] tracking-wide mb-2">
                        {category}
                      </h3>
                      <div className="space-y-1">
                        {types.map((type) => (
                          <button
                            key={type.id}
                            onClick={() => {
                              setSelectedType(type);
                              setSelectedAuthority(null); // Reset authority when type changes
                            }}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                              selectedType?.id === type.id
                                ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700'
                                : 'hover:bg-[var(--ff-bg-secondary)] border border-transparent'
                            }`}
                          >
                            <div className={`p-1.5 rounded ${
                              selectedType?.id === type.id
                                ? 'bg-blue-100 dark:bg-blue-900/50'
                                : 'bg-[var(--ff-bg-tertiary)]'
                            }`}>
                              <FileText className={`w-4 h-4 ${
                                selectedType?.id === type.id
                                  ? 'text-blue-600 dark:text-blue-400'
                                  : 'text-[var(--ff-text-secondary)]'
                              }`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className={`block truncate ${
                                selectedType?.id === type.id
                                  ? 'text-blue-700 dark:text-blue-300 font-medium'
                                  : 'text-[var(--ff-text-primary)]'
                              }`}>
                                {type.name}
                              </span>
                              {type.is_compulsory && (
                                <span className="text-xs text-orange-600 dark:text-orange-400">
                                  Compulsory
                                  {type.condition_type === 'rural_only' && ' (Rural only)'}
                                  {type.condition_type === 'urban_only' && ' (Urban only)'}
                                </span>
                              )}
                            </div>
                            {selectedType?.id === type.id && (
                              <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Authority Picker - only show when type is selected */}
              {selectedType && (
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                    <Building2 className="w-4 h-4 inline mr-1" />
                    Service Authority (Optional)
                  </label>
                  <AuthorityPicker
                    approvalTypeId={selectedType.id}
                    approvalTypeName={selectedType.name}
                    province={province}
                    municipality={municipality}
                    value={selectedAuthority}
                    onChange={setSelectedAuthority}
                    placeholder="Search for authority..."
                  />
                  <p className="mt-1 text-xs text-[var(--ff-text-tertiary)]">
                    Select an authority to auto-fill contact details
                  </p>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  Notes (Optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Add any notes about this approval..."
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--ff-border-light)]">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-secondary)] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !selectedType}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-accent)] text-white rounded-lg hover:bg-[var(--ff-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Add Approval
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddApprovalModal;
