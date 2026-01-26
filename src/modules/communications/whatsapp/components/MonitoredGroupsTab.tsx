/**
 * Monitored Groups Tab - WhatsApp Bridge Group Configuration
 * Manages which groups the Bridge monitors and how it processes them
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  MessageSquare,
  Wrench,
  Shield,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { waAdminApi } from '../services/waAdminApiService';
import type { WaMonitoredGroup, WaMonitoredGroupInput, WaGroupType } from '../types/wa-admin.types';

// Group type icons and colors
const GROUP_TYPE_CONFIG: Record<WaGroupType, { icon: React.ElementType; color: string; label: string; description: string }> = {
  dr_submission: {
    icon: MessageSquare,
    color: 'text-blue-500 bg-blue-500/10',
    label: 'DR Submission',
    description: 'New installation photos - sends detailed acknowledgment',
  },
  maintenance: {
    icon: Wrench,
    color: 'text-orange-500 bg-orange-500/10',
    label: 'Maintenance',
    description: 'Follow-up photos - reacts with emoji',
  },
  admin: {
    icon: Shield,
    color: 'text-purple-500 bg-purple-500/10',
    label: 'Admin',
    description: 'Commands and alerts - !status, !restart',
  },
};

const MonitoredGroupsTab: React.FC = () => {
  const [groups, setGroups] = useState<WaMonitoredGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<WaMonitoredGroup | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<WaMonitoredGroup | null>(null);
  const [filterType, setFilterType] = useState<WaGroupType | 'all'>('all');

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await waAdminApi.monitoredGroups.list();

    if (result.success && result.data) {
      setGroups(result.data);
    } else {
      setError(result.error || 'Failed to fetch monitored groups');
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleCreate = async (input: WaMonitoredGroupInput) => {
    const result = await waAdminApi.monitoredGroups.create(input);

    if (result.success) {
      setIsCreating(false);
      fetchGroups();
      toast.success('Group added to monitoring');
    } else {
      toast.error(result.error || 'Failed to add group');
    }
  };

  const handleUpdate = async (id: string, input: Partial<WaMonitoredGroupInput>) => {
    const result = await waAdminApi.monitoredGroups.update(id, input);

    if (result.success) {
      setEditingGroup(null);
      fetchGroups();
      toast.success('Group updated');
    } else {
      toast.error(result.error || 'Failed to update group');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingGroup) return;

    const result = await waAdminApi.monitoredGroups.delete(deletingGroup.id);

    if (result.success) {
      fetchGroups();
      toast.success('Group deactivated');
    } else {
      toast.error(result.error || 'Failed to deactivate group');
    }

    setDeletingGroup(null);
  };

  const handleToggleActive = async (group: WaMonitoredGroup) => {
    const result = await waAdminApi.monitoredGroups.update(group.id, {
      is_active: !group.is_active,
    });

    if (result.success) {
      fetchGroups();
      toast.success(group.is_active ? 'Group deactivated' : 'Group activated');
    } else {
      toast.error(result.error || 'Failed to update group');
    }
  };

  // Filter groups by type
  const filteredGroups = filterType === 'all'
    ? groups
    : groups.filter(g => g.group_type === filterType);

  // Group counts by type
  const typeCounts = groups.reduce((acc, g) => {
    acc[g.group_type] = (acc[g.group_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12" role="alert">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={fetchGroups}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Bridge Monitored Groups
          </h3>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Groups the WhatsApp Bridge monitors for incoming messages
          </p>
        </div>

        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Group
        </button>
      </div>

      {/* Type Filter Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button
          onClick={() => setFilterType('all')}
          className={`p-3 rounded-lg border transition-colors text-left ${
            filterType === 'all'
              ? 'border-green-500 bg-green-500/10'
              : 'border-[var(--ff-border-light)] hover:border-[var(--ff-border-medium)]'
          }`}
        >
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{groups.length}</div>
          <div className="text-sm text-[var(--ff-text-secondary)]">All Groups</div>
        </button>

        {(Object.entries(GROUP_TYPE_CONFIG) as [WaGroupType, typeof GROUP_TYPE_CONFIG[WaGroupType]][]).map(([type, config]) => {
          const Icon = config.icon;
          const count = typeCounts[type] || 0;
          return (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`p-3 rounded-lg border transition-colors text-left ${
                filterType === type
                  ? 'border-green-500 bg-green-500/10'
                  : 'border-[var(--ff-border-light)] hover:border-[var(--ff-border-medium)]'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`p-1 rounded ${config.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-2xl font-bold text-[var(--ff-text-primary)]">{count}</span>
              </div>
              <div className="text-sm text-[var(--ff-text-secondary)]">{config.label}</div>
            </button>
          );
        })}
      </div>

      {/* Groups Table */}
      <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Group</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Type</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Project</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Status</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredGroups.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--ff-text-secondary)]">
                  {filterType === 'all'
                    ? 'No groups configured. Click "Add Group" to start monitoring.'
                    : `No ${GROUP_TYPE_CONFIG[filterType as WaGroupType]?.label} groups configured.`}
                </td>
              </tr>
            ) : (
              filteredGroups.map((group) => {
                const typeConfig = GROUP_TYPE_CONFIG[group.group_type];
                const TypeIcon = typeConfig?.icon || MessageSquare;
                return (
                  <tr key={group.id} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-secondary)]">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-[var(--ff-text-primary)]">{group.group_name}</p>
                        <code className="text-xs text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] px-1 rounded">
                          {group.group_jid}
                        </code>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-sm ${typeConfig?.color || ''}`}>
                        <TypeIcon className="w-3.5 h-3.5" />
                        {typeConfig?.label || group.group_type}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--ff-text-primary)]">
                      {group.project_name || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(group)}
                        className={`inline-flex items-center gap-1 text-sm ${
                          group.is_active ? 'text-green-600' : 'text-[var(--ff-text-secondary)]'
                        }`}
                      >
                        {group.is_active ? (
                          <>
                            <CheckCircle className="w-4 h-4" /> Active
                          </>
                        ) : (
                          <>
                            <XCircle className="w-4 h-4" /> Inactive
                          </>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditingGroup(group)}
                          className="p-1.5 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors"
                          aria-label={`Edit ${group.group_name}`}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeletingGroup(group)}
                          className="p-1.5 text-red-600 hover:bg-red-500/10 rounded transition-colors"
                          aria-label={`Delete ${group.group_name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      {(isCreating || editingGroup) && (
        <MonitoredGroupFormModal
          group={editingGroup}
          onClose={() => {
            setIsCreating(false);
            setEditingGroup(null);
          }}
          onSave={(input) => {
            if (editingGroup) {
              handleUpdate(editingGroup.id, input);
            } else {
              handleCreate(input as WaMonitoredGroupInput);
            }
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deletingGroup && (
        <ConfirmDeactivateModal
          groupName={deletingGroup.group_name}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingGroup(null)}
        />
      )}
    </div>
  );
};

interface MonitoredGroupFormModalProps {
  group: WaMonitoredGroup | null;
  onClose: () => void;
  onSave: (input: WaMonitoredGroupInput | Partial<WaMonitoredGroupInput>) => void;
}

const MonitoredGroupFormModal: React.FC<MonitoredGroupFormModalProps> = ({ group, onClose, onSave }) => {
  const [formData, setFormData] = useState<WaMonitoredGroupInput>({
    group_jid: group?.group_jid || '',
    group_name: group?.group_name || '',
    project_name: group?.project_name || '',
    group_type: group?.group_type || 'dr_submission',
    description: group?.description || '',
    is_active: group?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div ref={modalRef} className="bg-[var(--ff-bg-card)] rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            {group ? 'Edit Monitored Group' : 'Add Monitored Group'}
          </h3>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                Group Name *
              </label>
              <input
                type="text"
                value={formData.group_name}
                onChange={(e) => setFormData({ ...formData, group_name: e.target.value })}
                className="w-full px-3 py-2 border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-green-500"
                placeholder="e.g., Lawley Maintenance"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                Group JID *
              </label>
              <input
                type="text"
                value={formData.group_jid}
                onChange={(e) => setFormData({ ...formData, group_jid: e.target.value })}
                className="w-full px-3 py-2 border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] font-mono text-sm focus:ring-2 focus:ring-green-500"
                placeholder="e.g., 120363418298130331@g.us"
                required
              />
              <p className="mt-1 text-xs text-[var(--ff-text-secondary)]">
                Must end with @g.us
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                Group Type *
              </label>
              <select
                value={formData.group_type}
                onChange={(e) => setFormData({ ...formData, group_type: e.target.value as WaGroupType })}
                className="w-full px-3 py-2 border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-green-500"
              >
                {(Object.entries(GROUP_TYPE_CONFIG) as [WaGroupType, typeof GROUP_TYPE_CONFIG[WaGroupType]][]).map(([type, config]) => (
                  <option key={type} value={type}>
                    {config.label} - {config.description}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                Project Name
              </label>
              <input
                type="text"
                value={formData.project_name || ''}
                onChange={(e) => setFormData({ ...formData, project_name: e.target.value })}
                className="w-full px-3 py-2 border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-green-500"
                placeholder="e.g., Lawley (for DR association)"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                Description
              </label>
              <input
                type="text"
                value={formData.description || ''}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-green-500"
                placeholder="e.g., Lawley maintenance tracking"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="w-4 h-4 text-green-500 border-[var(--ff-border-medium)] rounded focus:ring-green-500"
              />
              <label htmlFor="is_active" className="text-sm text-[var(--ff-text-primary)]">
                Active (Bridge will monitor this group)
              </label>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-[var(--ff-border-light)] flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : group ? 'Update' : 'Add Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface ConfirmDeactivateModalProps {
  groupName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDeactivateModal: React.FC<ConfirmDeactivateModalProps> = ({ groupName, onConfirm, onCancel }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--ff-bg-card)] rounded-lg shadow-xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Deactivate Group
          </h3>
        </div>
        <p className="text-[var(--ff-text-secondary)] mb-6">
          Are you sure you want to deactivate &quot;{groupName}&quot;? The Bridge will stop monitoring this group.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Deactivate
          </button>
        </div>
      </div>
    </div>
  );
};

export default MonitoredGroupsTab;
