/**
 * QField Project Modal
 * Add or edit a QField project with optional FibreFlow project links
 * Supports discovering projects from QFieldCloud
 */

'use client';

import React, { useState, useEffect } from 'react';
import { X, Search, RefreshCw, Check } from 'lucide-react';
import type { QFieldProject, QFieldCloudProject } from '../../../types';

interface QFieldProjectModalProps {
  project: QFieldProject | null; // null = add mode
  onClose: () => void;
  onSave: () => void;
}

interface FFProject {
  id: string;
  project_name: string;
  project_code: string;
}

export function QFieldProjectModal({ project, onClose, onSave }: QFieldProjectModalProps) {
  const isEdit = !!project;

  // Form state
  const [name, setName] = useState(project?.name || '');
  const [qfieldProjectId, setQfieldProjectId] = useState(project?.qfield_project_id || '');
  const [description, setDescription] = useState(project?.description || '');
  const [qfieldUrl, setQfieldUrl] = useState(project?.qfield_url || '');
  const [isDefault, setIsDefault] = useState(project?.is_default || false);
  const [syncEnabled, setSyncEnabled] = useState(project?.sync_enabled !== false);
  const [linkedProjectIds, setLinkedProjectIds] = useState<string[]>(
    project?.linked_projects?.map((lp) => lp.id) || []
  );

  // Discovery state
  const [discoveredProjects, setDiscoveredProjects] = useState<QFieldCloudProject[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);

  // FF Projects state
  const [ffProjects, setFfProjects] = useState<FFProject[]>([]);
  const [ffLoading, setFfLoading] = useState(false);
  const [ffSearch, setFfSearch] = useState('');

  // Save state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch FibreFlow projects for linking
  useEffect(() => {
    async function fetchFFProjects() {
      setFfLoading(true);
      try {
        const res = await fetch('/api/projects?limit=200');
        const data = await res.json();
        if (data.success !== false) {
          const list = Array.isArray(data) ? data : data.data || data.projects || [];
          setFfProjects(list);
        }
      } catch {
        // Non-critical
      } finally {
        setFfLoading(false);
      }
    }
    fetchFFProjects();
  }, []);

  const handleDiscover = async () => {
    setDiscoverLoading(true);
    setShowDiscover(true);
    try {
      const res = await fetch('/api/qfield/projects/discover');
      const data = await res.json();
      if (data.success) {
        setDiscoveredProjects(data.data);
      }
    } catch {
      // Non-critical
    } finally {
      setDiscoverLoading(false);
    }
  };

  const handleSelectDiscovered = (dp: QFieldCloudProject) => {
    setQfieldProjectId(dp.id);
    setName(dp.name);
    setShowDiscover(false);
  };

  const handleToggleLink = (projectId: string) => {
    setLinkedProjectIds((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId]
    );
  };

  const handleSave = async () => {
    if (!qfieldProjectId || !name) {
      setError('QFieldCloud Project ID and Name are required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const body = {
        qfield_project_id: qfieldProjectId,
        name,
        description: description || null,
        qfield_url: qfieldUrl || null,
        is_default: isDefault,
        sync_enabled: syncEnabled,
        linked_project_ids: linkedProjectIds,
      };

      const url = isEdit ? `/api/qfield/projects/${project.id}` : '/api/qfield/projects';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to save');
        return;
      }

      onSave();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const filteredFFProjects = ffProjects.filter(
    (p) =>
      !ffSearch ||
      p.project_name?.toLowerCase().includes(ffSearch.toLowerCase()) ||
      p.project_code?.toLowerCase().includes(ffSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--ff-bg-primary)] rounded-xl shadow-xl border border-[var(--ff-border-light)] w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)]">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            {isEdit ? 'Edit QField Project' : 'Add QField Project'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-[var(--ff-bg-tertiary)] rounded">
            <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {error && (
            <div className="p-3 text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg border border-red-200 dark:border-red-800">
              {error}
            </div>
          )}

          {/* QFieldCloud Project ID */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              QFieldCloud Project ID *
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={qfieldProjectId}
                onChange={(e) => setQfieldProjectId(e.target.value)}
                disabled={isEdit}
                placeholder="e849b878-f8a8-4f84-a3f1-9fbd051686c0"
                className="flex-1 px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] disabled:opacity-50"
              />
              {!isEdit && (
                <button
                  onClick={handleDiscover}
                  disabled={discoverLoading}
                  className="flex items-center gap-1 px-3 py-2 text-sm bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg transition-colors"
                  title="Discover from QFieldCloud"
                >
                  <Search className={`w-4 h-4 ${discoverLoading ? 'animate-spin' : ''}`} />
                  Discover
                </button>
              )}
            </div>
          </div>

          {/* Discovery Dropdown */}
          {showDiscover && (
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg border border-[var(--ff-border-light)] max-h-48 overflow-y-auto">
              {discoverLoading ? (
                <div className="p-4 text-center text-sm text-[var(--ff-text-secondary)]">
                  <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1" />
                  Fetching from QFieldCloud...
                </div>
              ) : discoveredProjects.length === 0 ? (
                <div className="p-4 text-center text-sm text-[var(--ff-text-secondary)]">
                  No projects found
                </div>
              ) : (
                discoveredProjects.map((dp) => (
                  <button
                    key={dp.id}
                    onClick={() => handleSelectDiscovered(dp)}
                    disabled={dp.already_registered}
                    className={`w-full text-left px-4 py-2 text-sm border-b border-[var(--ff-border-light)] last:border-b-0 ${
                      dp.already_registered
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-[var(--ff-bg-secondary)] cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--ff-text-primary)]">{dp.name}</span>
                      {dp.already_registered && (
                        <span className="text-xs text-[var(--ff-text-tertiary)]">Already added</span>
                      )}
                    </div>
                    <code className="text-xs text-[var(--ff-text-tertiary)]">{dp.id}</code>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Display Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Lawley OES Sync"
              className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]"
            />
          </div>

          {/* URL */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              QFieldCloud URL
            </label>
            <input
              type="text"
              value={qfieldUrl}
              onChange={(e) => setQfieldUrl(e.target.value)}
              placeholder="https://qfield.fibreflow.app/..."
              className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]"
            />
          </div>

          {/* Toggles */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-[var(--ff-text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="rounded"
              />
              Default for OES sync
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--ff-text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={syncEnabled}
                onChange={(e) => setSyncEnabled(e.target.checked)}
                className="rounded"
              />
              Sync enabled
            </label>
          </div>

          {/* Linked FibreFlow Projects */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Link to FibreFlow Projects
            </label>
            <input
              type="text"
              value={ffSearch}
              onChange={(e) => setFfSearch(e.target.value)}
              placeholder="Search projects..."
              className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] mb-2"
            />
            <div className="max-h-36 overflow-y-auto bg-[var(--ff-bg-tertiary)] rounded-lg border border-[var(--ff-border-light)]">
              {ffLoading ? (
                <div className="p-3 text-center text-sm text-[var(--ff-text-secondary)]">Loading...</div>
              ) : filteredFFProjects.length === 0 ? (
                <div className="p-3 text-center text-sm text-[var(--ff-text-secondary)]">No projects found</div>
              ) : (
                filteredFFProjects.map((fp) => {
                  const isLinked = linkedProjectIds.includes(fp.id);
                  return (
                    <button
                      key={fp.id}
                      onClick={() => handleToggleLink(fp.id)}
                      className={`w-full text-left px-3 py-2 text-sm border-b border-[var(--ff-border-light)] last:border-b-0 flex items-center justify-between ${
                        isLinked ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-[var(--ff-bg-secondary)]'
                      }`}
                    >
                      <span className="text-[var(--ff-text-primary)]">
                        {fp.project_name || fp.project_code || 'Unnamed'}
                      </span>
                      {isLinked && <Check className="w-4 h-4 text-blue-500" />}
                    </button>
                  );
                })
              )}
            </div>
            {linkedProjectIds.length > 0 && (
              <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                {linkedProjectIds.length} project(s) linked
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--ff-border-light)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !qfieldProjectId || !name}
            className="px-4 py-2 text-sm bg-[var(--ff-accent)] hover:opacity-90 text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Add Project'}
          </button>
        </div>
      </div>
    </div>
  );
}
