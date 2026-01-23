'use client';

import { useState } from 'react';

// Disable static generation - this page needs client-side data fetching
export const dynamic = 'force-dynamic';
import { useRouter } from 'next/navigation';
import { useProjects, useCreateProject, useDeleteProject } from '@/hooks/useProjects';
import { useStore } from '@/store/useStore';
import { useForm } from 'react-hook-form';
import { useWaMonitorSummary } from '@/modules/wa-monitor/hooks/useWaMonitorStats';
import { CheckCircle } from 'lucide-react';

interface NewProject {
  name: string;
  description?: string;
  status?: string;
  clientId?: string;
  projectType?: string;
  priority?: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
}

export default function ProjectsPage() {
  const router = useRouter();
  const [showCreateForm, setShowCreateForm] = useState(false);

  const { projectFilters, setProjectFilters, setSelectedProject } = useStore();

  const { data: projects, isLoading, isFetching, error } = useProjects();

  // Show loading state if loading OR if data hasn't been fetched yet
  const showLoading = isLoading || (isFetching && !projects);
  const createProjectMutation = useCreateProject();
  const deleteProjectMutation = useDeleteProject();

  const { data: waStats } = useWaMonitorSummary();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<NewProject>();

  const onSubmit = async (data: NewProject) => {
    try {
      await createProjectMutation.mutateAsync(data);
      reset();
      setShowCreateForm(false);
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const handleSelectProject = (project: any) => {
    setSelectedProject(project);
    router.push(`/projects/${project.id}`);
  };

  const handleDeleteProject = async (id: number) => {
    if (confirm('Are you sure you want to delete this project?')) {
      await deleteProjectMutation.mutateAsync(id);
    }
  };

  const handleFilterChange = (key: string, value: string) => {
    setProjectFilters({ [key]: value || undefined });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Projects</h1>
        <p className="text-sm text-[var(--ff-text-secondary)] mt-1">Manage your FibreFlow projects</p>
      </div>

      {/* WA Monitor Stats Card */}
      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm text-[var(--ff-text-secondary)]">QA Drops Today</p>
            {waStats ? (
              <>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)] mt-1">
                  {waStats.total.toLocaleString()}
                </p>
                {waStats.total > 0 && (
                  <>
                    <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
                      {waStats.complete} Complete • {waStats.incomplete} Incomplete
                    </p>
                    <div className="flex items-center mt-2">
                      <span className={`text-sm font-medium ${
                        waStats.completionRate >= 80 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {waStats.completionRate >= 80 ? '↑' : '↓'} {waStats.completionRate}% Complete
                      </span>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="h-8 w-16 bg-[var(--ff-bg-tertiary)] rounded animate-pulse mt-1" />
            )}
          </div>
          <div className="h-12 w-12 bg-purple-500/20 rounded-full flex items-center justify-center flex-shrink-0 ml-4">
            <CheckCircle className="h-6 w-6 text-purple-400" />
          </div>
        </div>
      </div>

      {/* Filters and Actions */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search projects..."
              className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-[var(--ff-text-tertiary)]"
              value={projectFilters.search || ''}
              onChange={(e) => handleFilterChange('search', e.target.value)}
            />
          </div>

          <select
            className="px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={projectFilters.status || ''}
            onChange={(e) => handleFilterChange('status', e.target.value)}
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>

          <button
            onClick={() => router.push('/projects/new')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Create Project
          </button>
        </div>
      </div>

      {/* Create Project Form */}
      {showCreateForm && (
        <div className="p-6 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <h2 className="text-xl font-semibold mb-4 text-[var(--ff-text-primary)]">Create New Project</h2>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Project Name *
              </label>
              <input
                {...register('name', { required: 'Project name is required' })}
                type="text"
                className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-400">{errors.name.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Description
              </label>
              <textarea
                {...register('description')}
                rows={3}
                className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Status
              </label>
              <select
                {...register('status')}
                className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="pending">Pending</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </div>

            <div className="flex gap-4">
              <button
                type="submit"
                disabled={createProjectMutation.isPending}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {createProjectMutation.isPending ? 'Creating...' : 'Create Project'}
              </button>
              <button
                type="button"
                onClick={() => {
                  reset();
                  setShowCreateForm(false);
                }}
                className="px-6 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors border border-[var(--ff-border-light)]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Projects List */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg overflow-hidden border border-[var(--ff-border-light)]">
        {showLoading ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Description</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Created</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
                {[...Array(5)].map((_, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4"><div className="h-4 w-32 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-48 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" /></td>
                    <td className="px-6 py-4"><div className="h-5 w-16 bg-[var(--ff-bg-tertiary)] rounded-full animate-pulse" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-24 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" /></td>
                    <td className="px-6 py-4 text-right"><div className="h-4 w-12 bg-[var(--ff-bg-tertiary)] rounded animate-pulse ml-auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-red-400">Error loading projects</p>
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
                {projects.map((project) => (
                  <tr
                    key={project.id}
                    className="hover:bg-[var(--ff-bg-hover)] cursor-pointer"
                    onClick={() => handleSelectProject(project)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-[var(--ff-text-primary)]">
                      {project.name}
                    </td>
                    <td className="px-6 py-4 text-sm text-[var(--ff-text-secondary)]">
                      {project.description || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          project.status === 'active'
                            ? 'bg-green-500/20 text-green-400'
                            : project.status === 'completed'
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                        }`}
                      >
                        {project.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-secondary)]">
                      {(project.created_at || project.createdAt)
                        ? new Date(project.created_at || project.createdAt).toLocaleDateString()
                        : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteProject(project.id);
                        }}
                        className="text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="text-[var(--ff-text-secondary)]">No projects found</p>
          </div>
        )}
      </div>
    </div>
  );
}
