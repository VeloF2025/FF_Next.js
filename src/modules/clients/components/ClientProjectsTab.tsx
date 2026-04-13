/**
 * Client Projects Tab
 * Enhanced view of client projects with PO information
 */

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { useQuery } from '@tanstack/react-query';
import { 
  FileText, 
  Plus, 
  ExternalLink, 
  TrendingUp,
  DollarSign,
  Clock,
  CheckCircle,
  AlertCircle,
  Package
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { formatCurrency } from '../utils/clientUtils';

interface ClientProject {
  id: string;
  name: string;
  code: string;
  status: string;
  priority: string;
  projectType: string;
  budget: number;
  actualCost: number;
  progress: number;
  projectManager: string;
  startDate: string;
  endDate: string;
  poCount: number;
  totalPoValue: number;
  pendingPoValue: number;
  approvedPoCount: number;
  pendingPoCount: number;
}

interface ClientProjectsSummary {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  totalValue: number;
  totalPoValue: number;
  pendingPoValue: number;
  outstandingBalance: number;
}

interface ClientProjectsTabProps {
  clientId: string;
  clientName: string;
  requiresPO?: boolean;
}

async function fetchClientProjects(clientId: string) {
  const response = await fetch(`/api/clients/${clientId}/projects`);
  if (!response.ok) {
    throw new Error('Failed to fetch client projects');
  }
  const data = await response.json();
  return data.data;
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  active: { label: 'Active', color: 'bg-green-500/20 text-green-400', icon: TrendingUp },
  planning: { label: 'Planning', color: 'bg-purple-500/20 text-purple-400', icon: Clock },
  on_hold: { label: 'On Hold', color: 'bg-yellow-500/20 text-yellow-400', icon: AlertCircle },
  completed: { label: 'Completed', color: 'bg-blue-500/20 text-blue-400', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/20 text-red-400', icon: AlertCircle },
};

const _priorityConfig: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: 'bg-red-500/20 text-red-400' },
  high: { label: 'High', color: 'bg-orange-500/20 text-orange-400' },
  medium: { label: 'Medium', color: 'bg-yellow-500/20 text-yellow-400' },
  low: { label: 'Low', color: 'bg-gray-500/20 text-gray-400' },
};

export function ClientProjectsTab({ clientId, clientName, requiresPO }: ClientProjectsTabProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  const { data, isLoading, error } = useQuery({
    queryKey: ['client-projects', clientId],
    queryFn: () => fetchClientProjects(clientId),
    enabled: !!clientId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" label="Loading projects..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-400">Failed to load projects</p>
      </div>
    );
  }

  const { projects, summary } = data as { projects: ClientProject[]; summary: ClientProjectsSummary };

  const filteredProjects = projects.filter(p => {
    if (filter === 'active') return p.status === 'active';
    if (filter === 'completed') return p.status === 'completed';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="ff-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[var(--ff-text-secondary)]">Total Projects</p>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{summary.totalProjects}</p>
            </div>
            <div className="p-2 rounded-lg bg-blue-500/20">
              <FileText className="w-5 h-5 text-blue-400" />
            </div>
          </div>
          <div className="mt-2 flex gap-2 text-xs">
            <span className="text-green-400">{summary.activeProjects} active</span>
            <span className="text-[var(--ff-text-tertiary)]">•</span>
            <span className="text-blue-400">{summary.completedProjects} done</span>
          </div>
        </div>

        <div className="ff-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[var(--ff-text-secondary)]">Total Value</p>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {formatCurrency(summary.totalValue)}
              </p>
            </div>
            <div className="p-2 rounded-lg bg-green-500/20">
              <DollarSign className="w-5 h-5 text-green-400" />
            </div>
          </div>
        </div>

        <div className="ff-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[var(--ff-text-secondary)]">Total PO Value</p>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {formatCurrency(summary.totalPoValue)}
              </p>
            </div>
            <div className="p-2 rounded-lg bg-purple-500/20">
              <Package className="w-5 h-5 text-purple-400" />
            </div>
          </div>
          {summary.pendingPoValue > 0 && (
            <p className="mt-2 text-xs text-yellow-400">
              {formatCurrency(summary.pendingPoValue)} pending approval
            </p>
          )}
        </div>

        <div className="ff-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[var(--ff-text-secondary)]">Outstanding</p>
              <p className={`text-2xl font-bold ${summary.outstandingBalance > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {formatCurrency(summary.outstandingBalance)}
              </p>
            </div>
            <div className={`p-2 rounded-lg ${summary.outstandingBalance > 0 ? 'bg-red-500/20' : 'bg-green-500/20'}`}>
              <DollarSign className={`w-5 h-5 ${summary.outstandingBalance > 0 ? 'text-red-400' : 'text-green-400'}`} />
            </div>
          </div>
        </div>
      </div>

      {/* PO Requirement Notice */}
      {requiresPO && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-center gap-3">
          <Package className="w-5 h-5 text-amber-400" />
          <p className="text-sm text-amber-200">
            This client requires a Purchase Order (PO) for all projects
          </p>
        </div>
      )}

      {/* Projects Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Projects</h3>
          
          {/* Filter Pills */}
          <div className="flex gap-1 ml-4">
            {(['all', 'active', 'completed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                  filter === f
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => router.push(`/projects/new?clientId=${clientId}&clientName=${encodeURIComponent(clientName)}`)}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Project
        </button>
      </div>

      {/* Projects Table */}
      {filteredProjects.length === 0 ? (
        <div className="ff-card p-8 text-center">
          <FileText className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
          <p className="text-[var(--ff-text-secondary)]">
            {filter === 'all' 
              ? 'No projects found for this client'
              : `No ${filter} projects found`
            }
          </p>
          <button
            onClick={() => router.push(`/projects/new?clientId=${clientId}&clientName=${encodeURIComponent(clientName)}`)}
            className="mt-4 text-blue-400 hover:text-blue-300 font-medium"
          >
            Create first project →
          </button>
        </div>
      ) : (
        <div className="ff-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)]">
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                    Project
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                    Progress
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                    Budget
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                    Purchase Orders
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                    Manager
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {filteredProjects.map((project) => {
                  const statusConf = (statusConfig[project.status] || statusConfig.active)!;
                  const StatusIcon = statusConf.icon;
                  
                  return (
                    <tr 
                      key={project.id}
                      className="hover:bg-[var(--ff-bg-hover)] transition-colors cursor-pointer"
                      onClick={() => router.push(`/projects/${project.id}`)}
                    >
                      <td className="px-4 py-4">
                        <div>
                          <p className="font-medium text-[var(--ff-text-primary)]">{project.name}</p>
                          <p className="text-xs text-[var(--ff-text-tertiary)]">{project.code}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusConf.color}`}>
                          <StatusIcon className="w-3.5 h-3.5" />
                          {statusConf.label}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${
                                project.progress >= 100 ? 'bg-green-500' :
                                project.progress >= 50 ? 'bg-blue-500' : 'bg-yellow-500'
                              }`}
                              style={{ width: `${Math.min(project.progress, 100)}%` }}
                            />
                          </div>
                          <span className="text-sm text-[var(--ff-text-secondary)]">{project.progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-medium text-[var(--ff-text-primary)]">
                          {formatCurrency(project.budget)}
                        </p>
                        {project.actualCost > 0 && (
                          <p className={`text-xs ${project.actualCost > project.budget ? 'text-red-400' : 'text-[var(--ff-text-tertiary)]'}`}>
                            Spent: {formatCurrency(project.actualCost)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {project.poCount > 0 ? (
                          <div>
                            <div className="flex items-center gap-2">
                              <Package className="w-4 h-4 text-purple-400" />
                              <span className="font-medium text-[var(--ff-text-primary)]">
                                {project.poCount} PO{project.poCount !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5">
                              {formatCurrency(project.totalPoValue)}
                            </p>
                            {project.pendingPoCount > 0 && (
                              <p className="text-xs text-yellow-400">
                                {project.pendingPoCount} pending
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-[var(--ff-text-tertiary)] text-sm">No POs</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm text-[var(--ff-text-secondary)]">{project.projectManager}</p>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/projects/${project.id}`);
                          }}
                          className="p-2 text-[var(--ff-text-tertiary)] hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
