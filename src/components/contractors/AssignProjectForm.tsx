/**
 * Assign Project Form
 * Form for assigning a contractor to a project
 */

'use client';

import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { createContractorProject } from '@/services/contractor/contractorProjectsService';
import { CONTRACTOR_ROLES } from '@/types/contractor-project.types';
import type { ContractorProjectFormData } from '@/types/contractor-project.types';
import { log } from '@/lib/logger';

interface AssignProjectFormProps {
  contractorId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

/** Slim project option shape for contractor assignment dropdown */
interface ProjectOption {
  id: string;
  project_name: string;
  project_code: string;
  status: string;
}

export function AssignProjectForm({ contractorId, onSuccess, onCancel }: AssignProjectFormProps) {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    projectId: '',
    role: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    workloadPercentage: 100,
    estimatedHours: '',
    contractValue: '',
    paymentTerms: '',
    isPrimaryContractor: false,
    notes: '',
  });

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    try {
      setLoading(true);

      // Temporary workaround: Use hardcoded projects from curl response
      // TODO: Fix Clerk middleware redirect loop for /api/projects
      const hardcodedProjects = [
        {
          id: "bf9a90db-e758-4c05-b999-694cd63c451f",
          project_name: "Mohadin",
          project_code: "PRJ-1761242661257",
          status: "active"
        },
        {
          id: "4eb13426-b2a1-472d-9b3c-277082ae9b55",
          project_name: "Lawley",
          project_code: "PRJ-1761224913968",
          status: "active"
        }
      ];

      setProjects(hardcodedProjects);

      // Original API call (currently causes redirect loop in browser):
      // const response = await fetch('/api/projects');
      // if (!response.ok) throw new Error('Failed to load projects');
      // const data = await response.json();
      // const projectsData = data.data || data;
      // setProjects(Array.isArray(projectsData) ? projectsData : []);

    } catch (err: any) {
      log.error('Error loading projects', { error: err }, 'AssignProjectForm');
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const assignmentData: ContractorProjectFormData = {
        contractorId,
        projectId: formData.projectId,
        role: formData.role,
        startDate: new Date(formData.startDate),
        endDate: formData.endDate ? new Date(formData.endDate) : undefined,
        workloadPercentage: formData.workloadPercentage,
        estimatedHours: formData.estimatedHours ? parseFloat(formData.estimatedHours) : undefined,
        contractValue: formData.contractValue ? parseFloat(formData.contractValue) : undefined,
        paymentTerms: formData.paymentTerms || undefined,
        isPrimaryContractor: formData.isPrimaryContractor,
        notes: formData.notes || undefined,
      };

      await createContractorProject(assignmentData);
      onSuccess();
    } catch (err: any) {
      log.error('Error creating assignment', { error: err }, 'AssignProjectForm');
      setError(err.message || 'Failed to create assignment');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-card p-6 rounded-lg border border-border">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          <span className="ml-2 text-muted-foreground">Loading projects...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card p-6 rounded-lg border border-border">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-foreground">Assign to Project</h3>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-muted-foreground"
          disabled={submitting}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Project Selection */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Project <span className="text-red-500">*</span>
          </label>
          <select
            value={formData.projectId}
            onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
            className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
            disabled={submitting}
          >
            <option value="">Select a project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.project_code} - {project.project_name}
              </option>
            ))}
          </select>
        </div>

        {/* Role */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Role <span className="text-red-500">*</span>
          </label>
          <select
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
            className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
            disabled={submitting}
          >
            <option value="">Select a role</option>
            {CONTRACTOR_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
            <option value="Other">Other (specify in notes)</option>
          </select>
        </div>

        {/* Date Range */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Start Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={formData.startDate}
              onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              End Date (Optional)
            </label>
            <input
              type="date"
              value={formData.endDate}
              onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min={formData.startDate}
              disabled={submitting}
            />
          </div>
        </div>

        {/* Workload & Hours */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Workload Percentage
            </label>
            <input
              type="number"
              value={formData.workloadPercentage}
              onChange={(e) => setFormData({ ...formData, workloadPercentage: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="0"
              max="100"
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground mt-1">0-100% of contractor's capacity</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Estimated Hours
            </label>
            <input
              type="number"
              value={formData.estimatedHours}
              onChange={(e) => setFormData({ ...formData, estimatedHours: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              step="0.5"
              min="0"
              placeholder="e.g., 160"
              disabled={submitting}
            />
          </div>
        </div>

        {/* Financial */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Contract Value (R)
            </label>
            <input
              type="number"
              value={formData.contractValue}
              onChange={(e) => setFormData({ ...formData, contractValue: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              step="0.01"
              min="0"
              placeholder="e.g., 50000"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Payment Terms
            </label>
            <input
              type="text"
              value={formData.paymentTerms}
              onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., Net 30"
              disabled={submitting}
            />
          </div>
        </div>

        {/* Primary Contractor */}
        <div className="flex items-center">
          <input
            type="checkbox"
            id="isPrimary"
            checked={formData.isPrimaryContractor}
            onChange={(e) => setFormData({ ...formData, isPrimaryContractor: e.target.checked })}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-border rounded"
            disabled={submitting}
          />
          <label htmlFor="isPrimary" className="ml-2 text-sm text-muted-foreground">
            Primary contractor on this project
          </label>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Notes
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={3}
            placeholder="Additional information about this assignment..."
            disabled={submitting}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-muted-foreground bg-card border border-border rounded-lg hover:bg-background"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            disabled={submitting}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? 'Creating Assignment...' : 'Create Assignment'}
          </button>
        </div>
      </form>
    </div>
  );
}
