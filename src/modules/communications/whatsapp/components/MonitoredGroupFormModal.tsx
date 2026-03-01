/**
 * MonitoredGroupFormModal - Create / Edit form for a monitored WhatsApp group
 * Extracted to keep MonitoredGroupsTab.tsx under 300 lines
 */

import React, { useState, useEffect, useRef } from 'react';
import type { WaMonitoredGroup, WaMonitoredGroupInput, WaGroupType } from '../types/wa-admin.types';
import { GROUP_TYPE_CONFIG } from './groupTypeConfig';
import { log } from '@/lib/logger';

interface ProjectOption {
  id: string;
  project_name: string;
}

export interface MonitoredGroupFormModalProps {
  group: WaMonitoredGroup | null;
  onClose: () => void;
  onSave: (input: WaMonitoredGroupInput | Partial<WaMonitoredGroupInput>) => void;
}

export const MonitoredGroupFormModal: React.FC<MonitoredGroupFormModalProps> = ({ group, onClose, onSave }) => {
  const [formData, setFormData] = useState<WaMonitoredGroupInput>({
    group_jid: group?.group_jid || '',
    group_name: group?.group_name || '',
    project_name: group?.project_name || '',
    project_id: group?.project_id || null,
    group_type: group?.group_type || 'dr_submission',
    description: group?.description || '',
    is_active: group?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Fetch projects list for the dropdown
  useEffect(() => {
    const fetchProjects = async () => {
      setProjectsLoading(true);
      try {
        const res = await fetch('/api/projects', { credentials: 'include' });
        if (res.ok) {
          const json = await res.json();
          // Handle both wrapped and unwrapped responses
          const rows: ProjectOption[] = Array.isArray(json) ? json : (json.data ?? []);
          setProjects(rows);
        }
      } catch (err) {
        log.error('[MonitoredGroupFormModal] Failed to fetch projects', { err });
      } finally {
        setProjectsLoading(false);
      }
    };

    fetchProjects();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const requiresProject = formData.group_type === 'civil' || formData.group_type === 'optical';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (requiresProject && !formData.project_id) {
      const typeLabel = formData.group_type ? GROUP_TYPE_CONFIG[formData.group_type]?.label : formData.group_type;
      setValidationError(`Group type "${typeLabel}" requires a project to be selected.`);
      return;
    }

    setSaving(true);
    await onSave(formData);
    setSaving(false);
  };

  const handleProjectChange = (projectId: string) => {
    const selected = projects.find(p => p.id === projectId);
    setFormData({
      ...formData,
      project_id: projectId || null,
      project_name: selected?.project_name || '',
    });
    if (projectId) setValidationError(null);
  };

  const handleTypeChange = (type: WaGroupType) => {
    const newData = { ...formData, group_type: type };
    // Clear validation error when switching away from civil/optical
    if (type !== 'civil' && type !== 'optical') {
      setValidationError(null);
    }
    setFormData(newData);
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
              <p className="mt-1 text-xs text-[var(--ff-text-secondary)]">Must end with @g.us</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                Group Type *
              </label>
              <select
                value={formData.group_type}
                onChange={(e) => handleTypeChange(e.target.value as WaGroupType)}
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
                Project {requiresProject ? '*' : ''}
              </label>
              <select
                value={formData.project_id || ''}
                onChange={(e) => handleProjectChange(e.target.value)}
                className={`w-full px-3 py-2 border rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-green-500 ${
                  validationError ? 'border-red-500' : 'border-[var(--ff-border-medium)]'
                }`}
                disabled={projectsLoading}
              >
                <option value="">
                  {projectsLoading ? 'Loading projects...' : '— Select a project —'}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_name}
                  </option>
                ))}
              </select>
              {validationError && (
                <p className="mt-1 text-xs text-red-500">{validationError}</p>
              )}
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
