/**
 * Monitored Groups Tab - WhatsApp Bridge Group Configuration
 * Manages which groups the Bridge monitors and how it processes them
 */

import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { waAdminApi } from '../services/waAdminApiService';
import type { WaMonitoredGroup, WaMonitoredGroupInput, WaGroupType } from '../types/wa-admin.types';
import { MonitoredGroupFormModal } from './MonitoredGroupFormModal';
import { ConfirmDeactivateModal } from './ConfirmDeactivateModal';
import { GROUP_TYPE_CONFIG } from './groupTypeConfig';

interface GroupTableRowProps {
  group: WaMonitoredGroup;
  onEdit: (g: WaMonitoredGroup) => void;
  onDelete: (g: WaMonitoredGroup) => void;
  onToggleActive: (g: WaMonitoredGroup) => void;
}

const GroupTableRow: React.FC<GroupTableRowProps> = ({ group, onEdit, onDelete, onToggleActive }) => {
  const typeConfig = GROUP_TYPE_CONFIG[group.group_type];
  const TypeIcon = typeConfig?.icon || MessageSquare;
  return (
    <tr className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-secondary)]">
      <td className="px-4 py-3">
        <p className="font-medium text-[var(--ff-text-primary)]">{group.group_name}</p>
        <code className="text-xs text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] px-1 rounded">{group.group_jid}</code>
      </td>
      <td className="px-4 py-3">
        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-sm ${typeConfig?.color || ''}`}>
          <TypeIcon className="w-3.5 h-3.5" />
          {typeConfig?.label || group.group_type}
        </div>
      </td>
      <td className="px-4 py-3 text-[var(--ff-text-primary)]">{group.project_name || '-'}</td>
      <td className="px-4 py-3 text-[var(--ff-text-secondary)] text-sm">{group.message_count || 0}</td>
      <td className="px-4 py-3 text-[var(--ff-text-secondary)] text-sm">
        {group.last_activity ? new Date(group.last_activity).toLocaleString() : '-'}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={() => onToggleActive(group)}
          className={`inline-flex items-center gap-1 text-sm ${group.is_active ? 'text-green-600' : 'text-[var(--ff-text-secondary)]'}`}
        >
          {group.is_active ? <><CheckCircle className="w-4 h-4" /> Active</> : <><XCircle className="w-4 h-4" /> Inactive</>}
        </button>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => onEdit(group)} className="p-1.5 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded" aria-label={`Edit ${group.group_name}`}>
            <Edit2 className="w-4 h-4" />
          </button>
          <button onClick={() => onDelete(group)} className="p-1.5 text-red-600 hover:bg-red-500/10 rounded" aria-label={`Delete ${group.group_name}`}>
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
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
      notificationService.success('Group added to monitoring');
    } else {
      notificationService.error(result.error || 'Failed to add group');
    }
  };

  const handleUpdate = async (id: string, input: Partial<WaMonitoredGroupInput>) => {
    const result = await waAdminApi.monitoredGroups.update(id, input);
    if (result.success) {
      setEditingGroup(null);
      fetchGroups();
      notificationService.success('Group updated');
    } else {
      notificationService.error(result.error || 'Failed to update group');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingGroup) return;
    const result = await waAdminApi.monitoredGroups.delete(deletingGroup.id);
    if (result.success) {
      fetchGroups();
      notificationService.success('Group deactivated');
    } else {
      notificationService.error(result.error || 'Failed to deactivate group');
    }
    setDeletingGroup(null);
  };

  const handleToggleActive = async (group: WaMonitoredGroup) => {
    const result = await waAdminApi.monitoredGroups.update(group.id, { is_active: !group.is_active });
    if (result.success) {
      fetchGroups();
      notificationService.success(group.is_active ? 'Group deactivated' : 'Group activated');
    } else {
      notificationService.error(result.error || 'Failed to update group');
    }
  };

  const filteredGroups = filterType === 'all' ? groups : groups.filter(g => g.group_type === filterType);
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
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Bridge Monitored Groups</h3>
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
                <span className="text-2xl font-bold text-[var(--ff-text-primary)]">{typeCounts[type] || 0}</span>
              </div>
              <div className="text-sm text-[var(--ff-text-secondary)]">{config.label}</div>
            </button>
          );
        })}
      </div>

      {/* Groups Table */}
      <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Group</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Type</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Project</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Messages</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Last Activity</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Status</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-[var(--ff-text-secondary)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredGroups.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--ff-text-secondary)]">
                  {filterType === 'all'
                    ? 'No groups configured. Click "Add Group" to start monitoring.'
                    : `No ${GROUP_TYPE_CONFIG[filterType as WaGroupType]?.label} groups configured.`}
                </td>
              </tr>
            ) : (
              filteredGroups.map((group) => (
                <GroupTableRow
                  key={group.id}
                  group={group}
                  onEdit={setEditingGroup}
                  onDelete={setDeletingGroup}
                  onToggleActive={handleToggleActive}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {(isCreating || editingGroup) && (
        <MonitoredGroupFormModal
          group={editingGroup}
          onClose={() => { setIsCreating(false); setEditingGroup(null); }}
          onSave={(input) => {
            if (editingGroup) {
              handleUpdate(editingGroup.id, input);
            } else {
              handleCreate(input as WaMonitoredGroupInput);
            }
          }}
        />
      )}

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

export default MonitoredGroupsTab;
