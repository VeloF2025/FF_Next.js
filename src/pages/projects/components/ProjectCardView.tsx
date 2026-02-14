/**
 * Project Card View Component
 * Card-based display of projects with visual design
 */

import { Plus, Building2, MoreVertical, Eye, Edit, Trash2, Calendar, DollarSign } from 'lucide-react';
import { Project } from '@/types/project.types';
import { statusColors, priorityColors } from '../types';
import { formatCurrency, formatDate, formatProjectType, formatPriority, formatProgressPercentage } from '../utils/formatters';

interface ProjectCardViewProps {
  projects: Project[];
  isLoading: boolean;
  searchTerm: string;
  hasActiveFilters: boolean;
  onProjectView: (id: string) => void;
  onProjectEdit: (id: string) => void;
  onProjectDelete: (id: string) => void;
  onCreateProject: () => void;
}

function LoadingCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="bg-card rounded-lg p-6 shadow-sm border border-border">
          <div className="animate-pulse">
            <div className="h-4 bg-secondary rounded w-3/4 mb-2"></div>
            <div className="h-3 bg-secondary rounded w-1/2 mb-4"></div>
            <div className="space-y-2">
              <div className="h-3 bg-secondary rounded w-full"></div>
              <div className="h-3 bg-secondary rounded w-5/6"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ searchTerm, hasActiveFilters, onCreateProject }: {
  searchTerm: string;
  hasActiveFilters: boolean;
  onCreateProject: () => void;
}) {
  return (
    <div className="text-center py-12">
      <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
      <h3 className="text-lg font-medium text-foreground mb-2">No projects found</h3>
      <p className="text-muted-foreground mb-4">
        {searchTerm || hasActiveFilters 
          ? 'Try adjusting your search or filters'
          : 'Get started by creating your first project'
        }
      </p>
      {!searchTerm && !hasActiveFilters && (
        <button
          onClick={onCreateProject}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-5 w-5 mr-2" />
          Create Project
        </button>
      )}
    </div>
  );
}

function ProjectCard({ 
  project, 
  onView, 
  onEdit, 
  onDelete 
}: { 
  project: Project;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-card rounded-lg shadow-sm border border-border hover:shadow-md transition-shadow">
      <div className="p-6 pb-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <h3 
              className="text-lg font-semibold text-foreground truncate cursor-pointer hover:text-blue-600"
              onClick={() => onView(project.id!)}
            >
              {project.name}
            </h3>
            <p className="text-sm text-muted-foreground">{project.code}</p>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Status Badge */}
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[project.status] || 'bg-secondary text-foreground'}`}>
              {project.status ? project.status.charAt(0).toUpperCase() + project.status.slice(1).replace('_', ' ') : 'Unknown'}
            </span>
            
            {/* Actions Menu */}
            <div className="relative group">
              <button className="p-1 text-gray-400 hover:text-muted-foreground rounded-full hover:bg-secondary">
                <MoreVertical className="h-4 w-4" />
              </button>
              <div className="absolute right-0 top-8 bg-card shadow-lg border border-border rounded-lg py-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10 min-w-[120px]">
                <button
                  onClick={() => onView(project.id!)}
                  className="flex items-center w-full px-3 py-2 text-sm text-muted-foreground hover:bg-background"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  View
                </button>
                <button
                  onClick={() => onEdit(project.id!)}
                  className="flex items-center w-full px-3 py-2 text-sm text-muted-foreground hover:bg-background"
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </button>
                <button
                  onClick={() => onDelete(project.id!)}
                  className="flex items-center w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Client Info */}
        <div className="flex items-center text-sm text-muted-foreground mb-3">
          <Building2 className="h-4 w-4 mr-1" />
          {project.clientName || 'No client assigned'}
        </div>

        {/* Project Type & Priority */}
        <div className="flex items-center gap-2 mb-4">
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-secondary text-foreground">
            {formatProjectType(project.projectType)}
          </span>
          <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${priorityColors[project.priority] || 'bg-secondary text-foreground'}`}>
            {formatPriority(project.priority)}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground mb-1">
            <span>Progress</span>
            <span>{formatProgressPercentage(project.actualProgress)}%</span>
          </div>
          <div className="w-full bg-secondary rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${project.actualProgress || 0}%` }}
            ></div>
          </div>
        </div>

        {/* Project Stats */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center text-muted-foreground">
            <Calendar className="h-4 w-4 mr-2" />
            <div>
              <p className="text-xs text-muted-foreground">Due Date</p>
              <p className="font-medium">{formatDate(project.endDate)}</p>
            </div>
          </div>
          
          <div className="flex items-center text-muted-foreground">
            <DollarSign className="h-4 w-4 mr-2" />
            <div>
              <p className="text-xs text-muted-foreground">Budget</p>
              <p className="font-medium">{formatCurrency(project.budget || 0)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectCardView({
  projects,
  isLoading,
  searchTerm,
  hasActiveFilters,
  onProjectView,
  onProjectEdit,
  onProjectDelete,
  onCreateProject
}: ProjectCardViewProps) {
  if (isLoading) {
    return <LoadingCards />;
  }

  if (projects.length === 0) {
    return (
      <EmptyState 
        searchTerm={searchTerm}
        hasActiveFilters={hasActiveFilters}
        onCreateProject={onCreateProject}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          onView={onProjectView}
          onEdit={onProjectEdit}
          onDelete={onProjectDelete}
        />
      ))}
    </div>
  );
}