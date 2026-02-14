/**
 * QField Projects Tab
 * Lists registered QField projects, allows add/edit/toggle/set default
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Star,
  StarOff,
  Pencil,
  Power,
  PowerOff,
  RefreshCw,
  ExternalLink,
  Clock,
  Link2,
} from 'lucide-react';
import type { QFieldProject } from '../../../types';
import { QFieldProjectModal } from './QFieldProjectModal';

export function QFieldProjectsTab() {
  const [projects, setProjects] = useState<QFieldProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<QFieldProject | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/qfield/projects');
      const data = await res.json();
      if (data.success) {
        setProjects(data.data);
        setError(null);
      } else {
        setError(data.error || 'Failed to load projects');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleToggleDefault = async (project: QFieldProject) => {
    setActionLoading(project.id);
    try {
      await fetch(`/api/qfield/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: !project.is_default }),
      });
      await fetchProjects();
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleActive = async (project: QFieldProject) => {
    setActionLoading(project.id);
    try {
      await fetch(`/api/qfield/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !project.is_active }),
      });
      await fetchProjects();
    } finally {
      setActionLoading(null);
    }
  };

  const handleEdit = (project: QFieldProject) => {
    setEditingProject(project);
    setShowModal(true);
  };

  const handleAdd = () => {
    setEditingProject(null);
    setShowModal(true);
  };

  const handleModalClose = () => {
    setShowModal(false);
    setEditingProject(null);
  };

  const handleModalSave = async () => {
    setShowModal(false);
    setEditingProject(null);
    await fetchProjects();
  };

  const formatDate = (date: string | null) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-8 text-center">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[var(--ff-accent)]" />
        <p className="mt-2 text-[var(--ff-text-secondary)]">Loading QField projects...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 p-6">
        <p className="text-red-700 dark:text-red-400">Error: {error}</p>
        <button onClick={fetchProjects} className="mt-2 text-sm text-red-600 underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-[var(--ff-text-primary)]">
            QFieldCloud Projects
          </h3>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Manage QFieldCloud projects used as import targets for OES and other data syncs
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchProjects}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg border border-[var(--ff-border-light)] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-[var(--ff-accent)] hover:opacity-90 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Project
          </button>
        </div>
      </div>

      {/* Projects Table */}
      {projects.length === 0 ? (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-8 text-center">
          <p className="text-[var(--ff-text-secondary)]">No QField projects registered yet.</p>
          <button onClick={handleAdd} className="mt-2 text-[var(--ff-accent)] text-sm underline">
            Add your first project
          </button>
        </div>
      ) : (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
                <th className="text-left px-4 py-3 font-medium text-[var(--ff-text-secondary)]">Project</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--ff-text-secondary)]">QFieldCloud ID</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--ff-text-secondary)]">Linked FF Projects</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--ff-text-secondary)]">Last Synced</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--ff-text-secondary)]">Status</th>
                <th className="text-right px-4 py-3 font-medium text-[var(--ff-text-secondary)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr
                  key={project.id}
                  className={`border-b border-[var(--ff-border-light)] last:border-b-0 ${
                    !project.is_active ? 'opacity-50' : ''
                  }`}
                >
                  {/* Name */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {project.is_default && (
                        <Star className="w-4 h-4 text-yellow-500 fill-yellow-500 flex-shrink-0" title="Default project" />
                      )}
                      <div>
                        <div className="font-medium text-[var(--ff-text-primary)]">{project.name}</div>
                        {project.description && (
                          <div className="text-xs text-[var(--ff-text-tertiary)]">{project.description}</div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* QFieldCloud ID */}
                  <td className="px-4 py-3">
                    <code className="text-xs bg-[var(--ff-bg-tertiary)] px-2 py-1 rounded font-mono text-[var(--ff-text-secondary)]">
                      {project.qfield_project_id.substring(0, 8)}...
                    </code>
                  </td>

                  {/* Linked FF Projects */}
                  <td className="px-4 py-3">
                    {project.linked_projects.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {project.linked_projects.map((lp) => (
                          <span
                            key={lp.id}
                            className="inline-flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded"
                          >
                            <Link2 className="w-3 h-3" />
                            {lp.project_name || lp.project_code}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--ff-text-tertiary)]">No links</span>
                    )}
                  </td>

                  {/* Last Synced */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)]">
                      <Clock className="w-3 h-3" />
                      {formatDate(project.last_synced_at)}
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <span
                        className={`inline-flex items-center text-xs px-2 py-0.5 rounded ${
                          project.is_active
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                            : 'bg-secondary text-muted-foreground'
                        }`}
                      >
                        {project.is_active ? 'Active' : 'Inactive'}
                      </span>
                      {project.sync_enabled && project.is_active && (
                        <span className="inline-flex items-center text-xs px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                          Sync On
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleToggleDefault(project)}
                        disabled={actionLoading === project.id}
                        className="p-1.5 rounded hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                        title={project.is_default ? 'Remove default' : 'Set as default'}
                      >
                        {project.is_default ? (
                          <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                        ) : (
                          <StarOff className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                        )}
                      </button>
                      <button
                        onClick={() => handleToggleActive(project)}
                        disabled={actionLoading === project.id}
                        className="p-1.5 rounded hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                        title={project.is_active ? 'Deactivate' : 'Activate'}
                      >
                        {project.is_active ? (
                          <Power className="w-4 h-4 text-green-500" />
                        ) : (
                          <PowerOff className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                        )}
                      </button>
                      <button
                        onClick={() => handleEdit(project)}
                        className="p-1.5 rounded hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                      </button>
                      {project.qfield_url && (
                        <a
                          href={project.qfield_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                          title="Open in QFieldCloud"
                        >
                          <ExternalLink className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <QFieldProjectModal
          project={editingProject}
          onClose={handleModalClose}
          onSave={handleModalSave}
        />
      )}
    </div>
  );
}
