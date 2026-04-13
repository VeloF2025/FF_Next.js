/**
 * Add/Edit DevQueue Item Modal Component
 * Includes tabs for Basic Info and Agent OS Spec Details
 */

import { useState, useEffect } from 'react';
import { X, FileText, Target } from 'lucide-react';
import type { CreateDevQueueItemInput, UpdateDevQueueItemInput, DevQueuePriority, DevQueueEffort, DevQueueWorkType, DevQueueItem } from '../types/devQueue';

interface AddDevQueueItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateDevQueueItemInput) => Promise<unknown>;
  onUpdate?: (id: string, input: UpdateDevQueueItemInput) => Promise<unknown>;
  editItem?: DevQueueItem | null;
}

type TabType = 'basic' | 'spec';

// FormData extends CreateDevQueueItemInput which now includes spec fields
type FormData = CreateDevQueueItemInput;

export function AddDevQueueItemModal({ isOpen, onClose, onSubmit, onUpdate, editItem }: AddDevQueueItemModalProps) {
  const isEditMode = !!editItem;
  const [activeTab, setActiveTab] = useState<TabType>('basic');

  const [formData, setFormData] = useState<FormData>({
    title: '',
    description: '',
    priority: 'medium',
    effort_estimate: undefined,
    work_type: 'feature',
    business_value: undefined,
    problem_statement: '',
    acceptance_criteria: '',
    target_module: '',
    test_scenarios: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  // Pre-fill form when editing
  useEffect(() => {
    if (editItem) {
      setFormData({
        title: editItem.title,
        description: editItem.description || '',
        priority: editItem.priority,
        effort_estimate: editItem.effort_estimate,
        work_type: editItem.work_type || 'feature',
        business_value: editItem.business_value,
        problem_statement: editItem.problem_statement || '',
        acceptance_criteria: editItem.acceptance_criteria || '',
        target_module: editItem.target_module || '',
        test_scenarios: editItem.test_scenarios || '',
      });
      // If item has spec data, show spec tab
      if (editItem.problem_statement || editItem.acceptance_criteria) {
        setActiveTab('spec');
      } else {
        setActiveTab('basic');
      }
    } else {
      setFormData({
        title: '',
        description: '',
        priority: 'medium',
        effort_estimate: undefined,
        work_type: 'feature',
        business_value: undefined,
        problem_statement: '',
        acceptance_criteria: '',
        target_module: '',
        test_scenarios: '',
      });
      setActiveTab('basic');
    }
  }, [editItem]);

  const handleClose = () => {
    setTitleError(null);
    setActiveTab('basic');
    setFormData({
      title: '',
      description: '',
      priority: 'medium',
      effort_estimate: undefined,
      work_type: 'feature',
      business_value: undefined,
      problem_statement: '',
      acceptance_criteria: '',
      target_module: '',
      test_scenarios: '',
    });
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate title
    if (!formData.title.trim()) {
      setTitleError('Title is required');
      setActiveTab('basic');
      return;
    }
    setTitleError(null);

    setSubmitting(true);
    try {
      if (isEditMode && editItem && onUpdate) {
        await onUpdate(editItem.id, formData);
      } else {
        await onSubmit(formData);
      }
      handleClose();
    } catch (error) {
      // Error is handled by the hook
    } finally {
      setSubmitting(false);
    }
  };

  // Check if spec fields have content
  const hasSpecContent = !!(
    formData.problem_statement ||
    formData.acceptance_criteria ||
    formData.target_module ||
    formData.test_scenarios
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--ff-bg-primary)] rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--ff-border-light)]">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            {isEditMode ? 'Edit DevQueue Item' : 'Add DevQueue Item'}
          </h2>
          <button
            onClick={handleClose}
            className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-[var(--ff-border-light)] px-6">
          <nav className="-mb-px flex space-x-6">
            <button
              type="button"
              onClick={() => setActiveTab('basic')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 ${
                activeTab === 'basic'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
              }`}
            >
              <FileText className="h-4 w-4" />
              Basic Info
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('spec')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 ${
                activeTab === 'spec'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
              }`}
            >
              <Target className="h-4 w-4" />
              Spec Details
              {hasSpecContent && (
                <span className="w-2 h-2 rounded-full bg-green-500" title="Has spec content" />
              )}
            </button>
          </nav>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-4">
            {activeTab === 'basic' && (
              <>
                {/* Title */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => {
                      setFormData({ ...formData, title: e.target.value });
                      if (titleError) setTitleError(null);
                    }}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] ${
                      titleError ? 'border-red-500' : 'border-[var(--ff-border-light)]'
                    }`}
                    placeholder="Brief title for the feature"
                    required
                  />
                  {titleError && (
                    <p className="mt-1 text-sm text-red-500">{titleError}</p>
                  )}
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
                    placeholder="Detailed description of the feature and its benefits"
                    rows={3}
                  />
                </div>

                {/* Priority, Effort, and Work Type */}
                <div className="grid grid-cols-3 gap-4">
                  {/* Priority */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Priority
                    </label>
                    <select
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: e.target.value as DevQueuePriority })}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>

                  {/* Effort Estimate */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Effort Estimate
                    </label>
                    <select
                      value={formData.effort_estimate || ''}
                      onChange={(e) => setFormData({ ...formData, effort_estimate: (e.target.value || undefined) as DevQueueEffort })}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
                    >
                      <option value="">Not estimated</option>
                      <option value="XS">XS (1-2 hours)</option>
                      <option value="S">S (Half day)</option>
                      <option value="M">M (1-2 days)</option>
                      <option value="L">L (3-5 days)</option>
                      <option value="XL">XL (Week+)</option>
                    </select>
                  </div>

                  {/* Work Type */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                      Work Type
                    </label>
                    <select
                      value={formData.work_type || 'feature'}
                      onChange={(e) => setFormData({ ...formData, work_type: e.target.value as DevQueueWorkType })}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
                    >
                      <option value="feature">✨ Feature</option>
                      <option value="fix">🐛 Bug Fix</option>
                      <option value="amendment">📝 Amendment</option>
                      <option value="refactor">🔧 Refactor</option>
                    </select>
                  </div>
                </div>

                {/* Business Value */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Business Value (1-10)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={formData.business_value || ''}
                    onChange={(e) => setFormData({ ...formData, business_value: e.target.value ? Number(e.target.value) : undefined })}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
                    placeholder="Strategic importance (1-10)"
                  />
                </div>

                {/* Hint to add spec */}
                {!hasSpecContent && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800">
                      <strong>Tip:</strong> Add spec details in the &quot;Spec Details&quot; tab to enable Agent OS automated development.
                    </p>
                  </div>
                )}
              </>
            )}

            {activeTab === 'spec' && (
              <>
                {/* Problem Statement */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Problem Statement
                  </label>
                  <textarea
                    value={formData.problem_statement}
                    onChange={(e) => setFormData({ ...formData, problem_statement: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
                    placeholder="What problem does this feature solve? What is the current pain point?"
                    rows={3}
                  />
                  <p className="mt-1 text-xs text-[var(--ff-text-tertiary)]">
                    Context for developers about why this feature is needed
                  </p>
                </div>

                {/* Acceptance Criteria */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Acceptance Criteria
                  </label>
                  <textarea
                    value={formData.acceptance_criteria}
                    onChange={(e) => setFormData({ ...formData, acceptance_criteria: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] font-mono text-sm"
                    placeholder="- [ ] User can do X&#10;- [ ] System validates Y&#10;- [ ] Error shown when Z"
                    rows={5}
                  />
                  <p className="mt-1 text-xs text-[var(--ff-text-tertiary)]">
                    Clear, testable requirements in markdown checklist format
                  </p>
                </div>

                {/* Target Module */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Target Module
                  </label>
                  <input
                    type="text"
                    value={formData.target_module}
                    onChange={(e) => setFormData({ ...formData, target_module: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
                    placeholder="e.g., src/modules/workflow, app/api/contractors"
                  />
                  <p className="mt-1 text-xs text-[var(--ff-text-tertiary)]">
                    Which part of the codebase this feature affects
                  </p>
                </div>

                {/* Test Scenarios */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Test Scenarios
                  </label>
                  <textarea
                    value={formData.test_scenarios}
                    onChange={(e) => setFormData({ ...formData, test_scenarios: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] font-mono text-sm"
                    placeholder="- Given X, when Y, then Z&#10;- Happy path: user completes flow&#10;- Error case: invalid input shows message"
                    rows={4}
                  />
                  <p className="mt-1 text-xs text-[var(--ff-text-tertiary)]">
                    How to verify the feature works correctly
                  </p>
                </div>

                {/* Agent OS hint */}
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-800">
                    <strong>Agent OS Ready:</strong> These spec fields can be exported to create an Agent OS spec file for automated development.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Actions - Fixed at bottom */}
          <div className="flex justify-end gap-3 p-6 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)]">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-[var(--ff-text-primary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !formData.title.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting
                ? (isEditMode ? 'Saving...' : 'Adding...')
                : (isEditMode ? 'Save Changes' : 'Add Item')
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
