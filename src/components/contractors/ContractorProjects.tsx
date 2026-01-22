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
      console.error('Error loading projects:', err);
      setError(err.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/4"></div>
          <div className="h-20 bg-gray-200 rounded"></div>
          <div className="h-20 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <div className="flex items-center gap-2 text-red-600">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  const activeProjects = projects.filter(p => p.assignmentStatus === 'active');
  const completedProjects = projects.filter(p => p.assignmentStatus === 'completed');

  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Project Assignments
          </h2>
          <p className="text-sm text-gray-600 mt-1">
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
        <div className="text-center py-12 text-gray-500">
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
      blue: 'bg-blue-100 text-blue-800',
      green: 'bg-green-100 text-green-800',
      gray: 'bg-gray-100 text-gray-800',
      red: 'bg-red-100 text-red-800',
      yellow: 'bg-yellow-100 text-yellow-800',
    };
    return classes[color] || classes.gray;
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {/* Project Name and Code */}
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-semibold text-gray-900">{project.projectName}</h3>
            <span className="text-sm text-gray-500">{project.projectCode}</span>
            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusBgClass(statusColor)}`}>
              {statusConfig?.label || project.assignmentStatus}
            </span>
          </div>

          {/* Role */}
          <p className="text-sm text-gray-600 mb-3">
            <span className="font-medium">Role:</span> {project.role}
          </p>

          {/* Details Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            {/* Timeline */}
            <div className="flex items-center gap-2 text-gray-600">
              <Calendar className="h-4 w-4" />
              <div>
                <div className="font-medium text-gray-900">
                  {new Date(project.startDate).toISOString().split('T')[0]}
                </div>
                {project.endDate && (
                  <div className="text-xs text-gray-500">
                    Until {new Date(project.endDate).toISOString().split('T')[0]}
                  </div>
                )}
              </div>
            </div>

            {/* Workload */}
            <div className="flex items-center gap-2 text-gray-600">
              <TrendingUp className="h-4 w-4" />
              <div>
                <div className="font-medium text-gray-900">
                  {project.workloadPercentage}% capacity
                </div>
                {project.estimatedHours && (
                  <div className="text-xs text-gray-500">
                    {project.estimatedHours} est. hours
                  </div>
                )}
              </div>
            </div>

            {/* Contract Value */}
            {project.contractValue && (
              <div className="flex items-center gap-2 text-gray-600">
                <DollarSign className="h-4 w-4" />
                <div>
                  <div className="font-medium text-gray-900">
                    R {project.contractValue.toLocaleString()}
                  </div>
                  {project.paymentTerms && (
                    <div className="text-xs text-gray-500">
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
              <span className="text-gray-600">Performance:</span>
              <div className="flex items-center gap-1">
                <span className="font-medium text-gray-900">
                  {project.performanceRating.toFixed(1)}/5.0
                </span>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <div
                      key={star}
                      className={`h-3 w-3 rounded-full ${
                        star <= Math.round(project.performanceRating!)
                          ? 'bg-yellow-400'
                          : 'bg-gray-200'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          {project.notes && (
            <div className="mt-3 text-sm text-gray-600 bg-gray-50 p-2 rounded">
              {project.notes}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
