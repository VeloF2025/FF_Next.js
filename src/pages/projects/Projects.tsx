/**
 * Projects Page - Modular Implementation
 * Main projects listing page with card/table views and filtering
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import { StandardModuleHeader } from '@/components/ui/StandardModuleHeader';
import { StandardSummaryCards } from '@/components/ui/StandardSummaryCards';
import { StandardSearchFilter } from '@/components/ui/StandardSearchFilter';
import { useProjectsData } from './hooks/useProjectsData';
import { ProjectFilters } from './components/ProjectFilters';
import { ProjectTableView } from './components/ProjectTableView';
import { ProjectCardView } from './components/ProjectCardView';
import { ProjectsPageProps } from './types';

export function Projects({ searchTerm: initialSearchTerm = '', initialFilter }: ProjectsPageProps = {}) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  
  const {
    projects,
    isLoading,
    error,
    summaryStats,
    filter,
    updateFilter,
    clearFilter,
    hasActiveFilters,
    getFilteredProjects,
    handleDeleteProject
  } = useProjectsData(initialFilter);

  const filteredProjects = getFilteredProjects(searchTerm);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Failed to load projects</h2>
          <p className="text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <StandardModuleHeader
          title="Projects"
          description="Manage and track all your fiber optic projects"
          itemCount={projects.length}
          onAdd={() => router.push('/app/projects/new')}
          addButtonText="New Project"
          addPermission="projects.list"
        />
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('card')}
            className={`px-3 py-1 rounded ${viewMode === 'card' ? 'bg-blue-600 text-white' : 'bg-secondary'}`}
          >
            Card
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1 rounded ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'bg-secondary'}`}
          >
            Table
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <StandardSummaryCards cards={summaryStats.map(stat => ({
        label: stat.title,
        value: stat.value,
        icon: stat.icon,
        trend: stat.trend
      }))} />

      {/* Search and Filters */}
      <StandardSearchFilter
        searchValue={searchTerm}
        onSearch={setSearchTerm}
        placeholder="Search projects by name, code, or client..."
        showFilters={showFilters}
      />

      {/* Filter Panel */}
      <ProjectFilters
        filter={filter}
        onUpdateFilter={updateFilter}
        onClearFilter={clearFilter}
        showFilters={showFilters}
        onToggleFilters={setShowFilters}
      />

      {/* Project Display - Card or Table View */}
      {viewMode === 'table' ? (
        <ProjectTableView
          projects={filteredProjects}
          isLoading={isLoading}
          onProjectView={(id) => router.push(`/app/projects/${id}`)}
        />
      ) : (
        <ProjectCardView
          projects={filteredProjects}
          isLoading={isLoading}
          searchTerm={searchTerm}
          hasActiveFilters={hasActiveFilters}
          onProjectView={(id) => router.push(`/app/projects/${id}`)}
          onProjectEdit={(id) => router.push(`/app/projects/${id}/edit`)}
          onProjectDelete={handleDeleteProject}
          onCreateProject={() => router.push('/app/projects/new')}
        />
      )}
    </div>
  );
}