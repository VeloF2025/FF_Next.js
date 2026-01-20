/**
 * Groups Tab - WhatsApp Group Management
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Send,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { waAdminApi } from '../services/waAdminApiService';
import type { WaGroupConfig, WaGroupConfigInput } from '../types/wa-admin.types';

const GroupsTab: React.FC = () => {
  const [groups, setGroups] = useState<WaGroupConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<WaGroupConfig | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [testingGroupId, setTestingGroupId] = useState<string | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<WaGroupConfig | null>(null);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await waAdminApi.groups.list();

    if (result.success && result.data) {
      setGroups(result.data);
    } else {
      setError(result.error || 'Failed to fetch groups');
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleCreate = async (input: WaGroupConfigInput) => {
    const result = await waAdminApi.groups.create(input);

    if (result.success) {
      setIsCreating(false);
      fetchGroups();
      toast.success('Group created successfully');
    } else {
      toast.error(result.error || 'Failed to create group');
    }
  };

  const handleUpdate = async (id: string, input: Partial<WaGroupConfigInput>) => {
    const result = await waAdminApi.groups.update(id, input);

    if (result.success) {
      setEditingGroup(null);
      fetchGroups();
      toast.success('Group updated successfully');
    } else {
      toast.error(result.error || 'Failed to update group');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingGroup) return;

    const result = await waAdminApi.groups.delete(deletingGroup.id);

    if (result.success) {
      fetchGroups();
      toast.success('Group deleted successfully');
    } else {
      toast.error(result.error || 'Failed to delete group');
    }

    setDeletingGroup(null);
  };

  const handleTest = async (group: WaGroupConfig) => {
    setTestingGroupId(group.id);

    const result = await waAdminApi.groups.test(group.id);

    if (result.success) {
      toast.success(`Test message sent to "${group.project_name}"`);
    } else {
      toast.error(`Failed to send test message: ${result.error}`);
    }

    setTestingGroupId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-label="Loading groups">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" aria-hidden="true" />
        <span className="sr-only">Loading groups...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12" role="alert">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" aria-hidden="true" />
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={fetchGroups}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
          WhatsApp Groups
        </h3>

        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Add Group
        </button>
      </div>

      {/* Groups Table */}
      <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
            <tr>
              <th scope="col" className="text-left px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Project</th>
              <th scope="col" className="text-left px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Group JID</th>
              <th scope="col" className="text-left px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Status</th>
              <th scope="col" className="text-right px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[var(--ff-text-secondary)]">
                  No groups configured. Click &quot;Add Group&quot; to create one.
                </td>
              </tr>
            ) : (
              groups.map((group) => (
                <tr key={group.id} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-secondary)]">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-[var(--ff-text-primary)]">{group.project_name}</p>
                      {group.group_name && (
                        <p className="text-xs text-[var(--ff-text-secondary)]">{group.group_name}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs bg-[var(--ff-bg-tertiary)] px-2 py-1 rounded">
                      {group.group_jid}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    {group.enabled ? (
                      <span className="inline-flex items-center gap-1 text-green-600 text-sm">
                        <CheckCircle className="w-4 h-4" aria-hidden="true" /> Enabled
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[var(--ff-text-secondary)] text-sm">
                        <XCircle className="w-4 h-4" aria-hidden="true" /> Disabled
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleTest(group)}
                        disabled={testingGroupId === group.id || !group.enabled}
                        className="p-1.5 text-blue-600 hover:bg-blue-500/10 dark:hover:bg-blue-500/20 rounded transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label={`Send test message to ${group.project_name}`}
                      >
                        {testingGroupId === group.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Send className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                      <button
                        onClick={() => setEditingGroup(group)}
                        className="p-1.5 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
                        aria-label={`Edit ${group.project_name}`}
                      >
                        <Edit2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => setDeletingGroup(group)}
                        className="p-1.5 text-red-600 hover:bg-red-500/10 dark:hover:bg-red-500/20 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                        aria-label={`Delete ${group.project_name}`}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      {(isCreating || editingGroup) && (
        <GroupFormModal
          group={editingGroup}
          onClose={() => {
            setIsCreating(false);
            setEditingGroup(null);
          }}
          onSave={(input) => {
            if (editingGroup) {
              handleUpdate(editingGroup.id, input);
            } else {
              handleCreate(input as WaGroupConfigInput);
            }
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deletingGroup && (
        <ConfirmDeleteModal
          groupName={deletingGroup.project_name}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingGroup(null)}
        />
      )}
    </div>
  );
};

interface GroupFormModalProps {
  group: WaGroupConfig | null;
  onClose: () => void;
  onSave: (input: WaGroupConfigInput | Partial<WaGroupConfigInput>) => void;
}

const GroupFormModal: React.FC<GroupFormModalProps> = ({ group, onClose, onSave }) => {
  const [formData, setFormData] = useState<WaGroupConfigInput>({
    project_name: group?.project_name || '',
    group_jid: group?.group_jid || '',
    group_name: group?.group_name || '',
    phone_number: group?.phone_number || '',
    enabled: group?.enabled ?? true,
  });
  const [saving, setSaving] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Focus first input on mount and trap focus
  useEffect(() => {
    firstInputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    await onSave(formData);

    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-form-title"
    >
      <div ref={modalRef} className="bg-[var(--ff-bg-card)] rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
          <h3 id="group-form-title" className="text-lg font-semibold text-[var(--ff-text-primary)]">
            {group ? 'Edit Group' : 'Add New Group'}
          </h3>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-4">
            <div>
              <label htmlFor="project_name" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                Project Name *
              </label>
              <input
                ref={firstInputRef}
                id="project_name"
                type="text"
                value={formData.project_name}
                onChange={(e) => setFormData({ ...formData, project_name: e.target.value })}
                className="w-full px-3 py-2 border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="e.g., Lawley"
                required
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="group_jid" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                Group JID *
              </label>
              <input
                id="group_jid"
                type="text"
                value={formData.group_jid}
                onChange={(e) => setFormData({ ...formData, group_jid: e.target.value })}
                className="w-full px-3 py-2 border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-green-500 font-mono text-sm"
                placeholder="e.g., 120363418298130331@g.us"
                required
                aria-required="true"
                aria-describedby="group_jid_help"
              />
              <p id="group_jid_help" className="mt-1 text-xs text-[var(--ff-text-secondary)]">
                Must end with @g.us for WhatsApp groups
              </p>
            </div>

            <div>
              <label htmlFor="group_name" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                Group Name
              </label>
              <input
                id="group_name"
                type="text"
                value={formData.group_name || ''}
                onChange={(e) => setFormData({ ...formData, group_name: e.target.value })}
                className="w-full px-3 py-2 border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="e.g., Lawley DR Photos"
              />
            </div>

            <div>
              <label htmlFor="phone_number" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                Phone Number
              </label>
              <input
                id="phone_number"
                type="text"
                value={formData.phone_number || ''}
                onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                className="w-full px-3 py-2 border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="e.g., +27711796125"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enabled"
                checked={formData.enabled}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="w-4 h-4 text-green-500 border-[var(--ff-border-medium)] rounded focus:ring-green-500"
              />
              <label htmlFor="enabled" className="text-sm text-[var(--ff-text-primary)]">
                Enabled
              </label>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-[var(--ff-border-light)] flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {saving ? 'Saving...' : group ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface ConfirmDeleteModalProps {
  groupName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({ groupName, onConfirm, onCancel }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }

      if (e.key !== 'Tab' || !modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      aria-describedby="delete-dialog-desc"
    >
      <div ref={modalRef} className="bg-[var(--ff-bg-card)] rounded-lg shadow-xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-600" aria-hidden="true" />
          </div>
          <h3 id="delete-dialog-title" className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Delete Group
          </h3>
        </div>
        <p id="delete-dialog-desc" className="text-[var(--ff-text-secondary)] mb-6">
          Are you sure you want to delete &quot;{groupName}&quot;? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            ref={cancelButtonRef}
            onClick={onCancel}
            className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

export default GroupsTab;
