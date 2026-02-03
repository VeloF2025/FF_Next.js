/**
 * Contractor Projects Component
 * Displays and manages contractor project assignments
 */

'use client';

import { useEffect, useState } from 'react';
import { Plus, Briefcase, Calendar, DollarSign, TrendingUp, AlertCircle } from 'lucide-react';
import { getContractorProjectsByContractor } from '@/services/contractor/contractorProjectsService';
import type { ContractorProjectWithDetails } from '@/types/contractor-project.types';
import { ASSIGNMENT_STATUSES } from '@/types/contractor-project.types';
import { AssignProjectForm } from './AssignProjectForm';
import { log } from '@/lib/logger';

interface ContractorProjectsProps {
  contractorId: string;
}

export function ContractorProjects({ contractorId }: ContractorProjectsProps) {
  const [projects, setProjects] = useState<ContractorProjectWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    loadProjects();
  }, [contractorId]);

  async function loadProjects() {
    try {
      setLoading(true);
      setError(null);
      const data = await getContractorProjectsByContractor(contractorId);
      setProjects(data);
    } catch (err: any) {
      log.error('Error loading contractor projects', { error: err, contractorId }, 'ContractorProjects');
      setError(err.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-1/4"></div>
          <div className="h-20 bg-[var(--ff-bg-tertiary)] rounded"></div>
          <div className="h-20 bg-[var(--ff-bg-tertiary)] rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  const activeProjects = projects.filter(p => p.assignmentStatus === 'active');
  const completedProjects = projects.filter(p => p.assignmentStatus === 'completed');

  return (
    <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Project Assignments
          </h2>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            {activeProjects.length} active, {completedProjects.length} completed
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Assign to Project
        </button>
      </div>

      {/* Add Assignment Form */}
      {showAddForm && (
        <div className="mb-6">
          <AssignProjectForm
            contractorId={contractorId}
            onSuccess={() => {
              setShowAddForm(false);
              loadProjects();
            }}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      {/* Projects List */}
      {projects.length === 0 ? (
        <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
          <Briefcase className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No project assignments yet</p>
          <p className="text-sm mt-1">Assign this contractor to a project to get started</p>
        </div>
      ) : (
        <div className="space-y-4">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} onUpdate={loadProjects} />
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== Project Card ====================

interface ProjectCardProps {
  project: ContractorProjectWithDetails;
  onUpdate: () => void;
}

function ProjectCard({ project, onUpdate }: ProjectCardProps) {
  const statusConfig = ASSIGNMENT_STATUSES.find(s => s.value === project.assignmentStatus);
  const statusColor = statusConfig?.color || 'gray';

  const getStatusBgClass = (color: string) => {
    const classes: Record<string, string> = {
      blue: 'bg-blue-500/20 text-blue-400',
      green: 'bg-green-500/20 text-green-400',
      gray: 'bg-gray-500/20 text-gray-400',
      red: 'bg-red-500/20 text-red-400',
      yellow: 'bg-yellow-500/20 text-yellow-400',
    };
    return classes[color] || classes.gray;
  };

  return (
    <div className="border border-[var(--ff-border-light)] rounded-lg p-4 hover:border-[var(--ff-border-medium)] transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {/* Project Name and Code */}
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-semibold text-[var(--ff-text-primary)]">{project.projectName}</h3>
            <span className="text-sm text-[var(--ff-text-tertiary)]">{project.projectCode}</span>
            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusBgClass(statusColor)}`}>
              {statusConfig?.label || project.assignmentStatus}
            </span>
          </div>

          {/* Role */}
          <p className="text-sm text-[var(--ff-text-secondary)] mb-3">
            <span className="font-medium">Role:</span> {project.role}
          </p>

          {/* Details Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            {/* Timeline */}
            <div className="flex items-center gap-2 text-[var(--ff-text-secondary)]">
              <Calendar className="h-4 w-4" />
              <div>
                <div className="font-medium text-[var(--ff-text-primary)]">
                  {new Date(project.startDate).toISOString().split('T')[0]}
                </div>
                {project.endDate && (
                  <div className="text-xs text-[var(--ff-text-tertiary)]">
                    Until {new Date(project.endDate).toISOString().split('T')[0]}
                  </div>
                )}
              </div>
            </div>

            {/* Workload */}
            <div className="flex items-center gap-2 text-[var(--ff-text-secondary)]">
              <TrendingUp className="h-4 w-4" />
              <div>
                <div className="font-medium text-[var(--ff-text-primary)]">
                  {project.workloadPercentage}% capacity
                </div>
                {project.estimatedHours && (
                  <div className="text-xs text-[var(--ff-text-tertiary)]">
                    {project.estimatedHours} est. hours
                  </div>
                )}
              </div>
            </div>

            {/* Contract Value */}
            {project.contractValue && (
              <div className="flex items-center gap-2 text-[var(--ff-text-secondary)]">
                <DollarSign className="h-4 w-4" />
                <div>
                  <div className="font-medium text-[var(--ff-text-primary)]">
                    R {project.contractValue.toLocaleString()}
                  </div>
                  {project.paymentTerms && (
                    <div className="text-xs text-[var(--ff-text-tertiary)]">
                      {project.paymentTerms}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Performance Rating */}
          {project.performanceRating && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="text-[var(--ff-text-secondary)]">Performance:</span>
              <div className="flex items-center gap-1">
                <span className="font-medium text-[var(--ff-text-primary)]">
                  {project.performanceRating.toFixed(1)}/5.0
                </span>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <div
                      key={star}
                      className={`h-3 w-3 rounded-full ${
                        star <= Math.round(project.performanceRating!)
                          ? 'bg-yellow-400'
                          : 'bg-[var(--ff-bg-tertiary)]'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          {project.notes && (
            <div className="mt-3 text-sm text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] p-2 rounded">
              {project.notes}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
