'use client';

/**
 * Staff Project Assignment Component
 * Manages staff-project assignments with role selection
 */

import { useState, useEffect } from 'react';
import {
  Briefcase,
  Plus,
  Trash2,
  Calendar,
  User,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { StaffProject, PROJECT_ROLES } from '@/types/staff-project.types';
import { createLogger } from '@/lib/logger';

const logger = createLogger('StaffProjectAssignment');

/** Slim project option for display in assignment dropdown */
interface ProjectOption {
  id: string;
  name: string;
  status?: string;
  client?: string;
}

interface StaffProjectAssignmentProps {
  staffId: string;
  staffName: string;
}

export function StaffProjectAssignment({ staffId, staffName }: StaffProjectAssignmentProps) {
  const [assignments, setAssignments] = useState<StaffProject[]>([]);
  const [availableProjects, setAvailableProjects] = useState<ProjectOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // New assignment form state
  const [newAssignment, setNewAssignment] = useState({
    projectId: '',
    role: '',
    startDate: '',
    endDate: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Fetch assignments
  const fetchAssignments = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/staff/${staffId}/projects`);
      if (!response.ok) throw new Error('Failed to fetch assignments');

      const data = await response.json();
      setAssignments(data.projects || []);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errMsg);
      logger.error('Failed to fetch assignments', { staffId, error: errMsg });
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch available projects
  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error('Failed to fetch projects');

      const data = await response.json();
      setAvailableProjects(data.projects || data.data || []);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      logger.error('Failed to fetch projects', { error: errMsg });
    }
  };

  useEffect(() => {
    fetchAssignments();
    fetchProjects();
  }, [staffId]);

  // Get unassigned projects
  const unassignedProjects = availableProjects.filter(
    (project) => !assignments.some((a) => a.projectId === project.id && a.isActive)
  );

  // Handle add assignment
  const handleAddAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAssignment.projectId) {
      setError('Please select a project');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/staff/${staffId}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: newAssignment.projectId,
          role: newAssignment.role || undefined,
          startDate: newAssignment.startDate || undefined,
          endDate: newAssignment.endDate || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to assign project');
      }

      logger.info('Staff assigned to project', { staffId, projectId: newAssignment.projectId });
      setShowAddForm(false);
      setNewAssignment({ projectId: '', role: '', startDate: '', endDate: '' });
      fetchAssignments();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errMsg);
      logger.error('Failed to assign project', { staffId, error: errMsg });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle remove assignment
  const handleRemoveAssignment = async (projectId: string) => {
    if (!confirm('Remove this staff member from the project?')) return;

    setRemovingId(projectId);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/staff?staffId=${staffId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to remove assignment');
      }

      logger.info('Staff removed from project', { staffId, projectId });
      setAssignments((prev) =>
        prev.map((a) => (a.projectId === projectId ? { ...a, isActive: false } : a))
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errMsg);
      logger.error('Failed to remove assignment', { staffId, projectId, error: errMsg });
    } finally {
      setRemovingId(null);
    }
  };

  // Get active assignments
  const activeAssignments = assignments.filter((a) => a.isActive);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Project Assignments</h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Assign to Project
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Add assignment form */}
      {showAddForm && (
        <form onSubmit={handleAddAssignment} className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg space-y-4 border border-[var(--ff-border-light)]">
          <h4 className="font-medium text-[var(--ff-text-primary)]">Assign {staffName} to Project</h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Project selection */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Project *
              </label>
              <select
                value={newAssignment.projectId}
                onChange={(e) => setNewAssignment({ ...newAssignment, projectId: e.target.value })}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select a project...</option>
                {unassignedProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} {project.client ? `(${project.client})` : ''}
                  </option>
                ))}
              </select>
              {unassignedProjects.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  All projects are already assigned
                </p>
              )}
            </div>

            {/* Role selection */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Role</label>
              <select
                value={newAssignment.role}
                onChange={(e) => setNewAssignment({ ...newAssignment, role: e.target.value })}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a role...</option>
                {PROJECT_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>

            {/* Start date */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Start Date</label>
              <input
                type="date"
                value={newAssignment.startDate}
                onChange={(e) => setNewAssignment({ ...newAssignment, startDate: e.target.value })}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* End date */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">End Date</label>
              <input
                type="date"
                value={newAssignment.endDate}
                onChange={(e) => setNewAssignment({ ...newAssignment, endDate: e.target.value })}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Form actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3 py-2 text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !newAssignment.projectId}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                  Assigning...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4" />
                  Assign
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Assignments list */}
      {activeAssignments.length === 0 ? (
        <div className="text-center py-12 ff-bg-tertiary rounded-lg">
          <Briefcase className="h-12 w-12 text-[var(--ff-text-secondary)] mx-auto mb-3" />
          <p className="text-[var(--ff-text-secondary)]">No project assignments</p>
          <p className="text-sm text-[var(--ff-text-secondary)] opacity-70 mt-1">
            Click &quot;Assign to Project&quot; to add this staff member to a project
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--ff-border-light)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          {activeAssignments.map((assignment) => (
            <div key={assignment.id} className="p-4 bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-hover)] transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <Briefcase className="h-5 w-5 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-[var(--ff-text-primary)]">
                      {assignment.project?.name || 'Unknown Project'}
                    </h4>
                    {assignment.project?.client && (
                      <p className="text-xs text-[var(--ff-text-secondary)]">{assignment.project.client}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {assignment.role && (
                        <span className="inline-flex items-center gap-1 text-xs text-[var(--ff-text-secondary)]">
                          <User className="h-3 w-3" />
                          {assignment.role}
                        </span>
                      )}
                      {assignment.startDate && (
                        <span className="inline-flex items-center gap-1 text-xs text-[var(--ff-text-secondary)]">
                          <Calendar className="h-3 w-3" />
                          {new Date(assignment.startDate).toISOString().split('T')[0]}
                          {assignment.endDate && (
                            <> - {new Date(assignment.endDate).toISOString().split('T')[0]}</>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <button
                  onClick={() => handleRemoveAssignment(assignment.projectId)}
                  disabled={removingId === assignment.projectId}
                  className="p-2 text-[var(--ff-text-secondary)] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                  title="Remove from project"
                >
                  {removingId === assignment.projectId ? (
                    <div className="animate-spin h-4 w-4 border-2 border-red-600 border-t-transparent rounded-full" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      <div className="text-sm text-[var(--ff-text-secondary)]">
        {activeAssignments.length} active project{activeAssignments.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
