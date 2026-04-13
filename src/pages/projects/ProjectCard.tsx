/**
 * Project Card Component
 */

import { Calendar, DollarSign, Building2, MoreVertical, Edit, Eye, Trash2 } from 'lucide-react';
import { Project } from '@/types/project.types';
import { statusColors, priorityColors } from '../detail/ProjectDetailHelpers';

interface ProjectCardProps {
  project: Project;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  formatDate: (date: Date | string | number | null | undefined) => string;
  formatCurrency: (amount: number) => string;
}

export function ProjectCard({ 
  project, 
  onView, 
  onEdit, 
  onDelete, 
  formatDate,
  formatCurrency 
}: ProjectCardProps) {
  return (
    <div className="bg-card rounded-lg shadow-sm border border-border hover:shadow-md transition-shadow">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {project.name}
            </h3>
            <p className="text-sm text-muted-foreground">{project.code}</p>
          </div>
          <div className="relative group">
            <button className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
              <MoreVertical className="h-5 w-5 text-gray-400" />
            </button>
            <div className="absolute right-0 mt-2 w-48 bg-card rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
              <div className="py-1">
                <button
                  onClick={() => onView(project.id)}
                  className="w-full text-left px-4 py-2 text-sm text-muted-foreground hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  View Details
                </button>
                <button
                  onClick={() => onEdit(project.id)}
                  className="w-full text-left px-4 py-2 text-sm text-muted-foreground hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center"
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </button>
                <button
                  onClick={() => onDelete(project.id)}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            statusColors[project.status] || 'bg-secondary text-foreground'
          }`}>
            {project.status ? project.status.charAt(0).toUpperCase() + project.status.slice(1).replace('_', ' ') : 'Unknown'}
          </span>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            priorityColors[project.priority] || 'bg-secondary text-foreground'
          }`}>
            {project.priority ? project.priority.charAt(0).toUpperCase() + project.priority.slice(1) : 'Normal'}
          </span>
        </div>

        <div className="space-y-2 text-sm text-muted-foreground">
          {project.clientName && (
            <div className="flex items-center">
              <Building2 className="h-4 w-4 mr-2" />
              {project.clientName}
            </div>
          )}
          <div className="flex items-center">
            <Calendar className="h-4 w-4 mr-2" />
            {formatDate(project.startDate)} - {formatDate(project.endDate)}
          </div>
          {project.budget && (
            <div className="flex items-center">
              <DollarSign className="h-4 w-4 mr-2" />
              {formatCurrency(project.budget)}
            </div>
          )}
        </div>

        {project.actualProgress !== undefined && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Progress</span>
              <span>{Math.round(project.actualProgress)}%</span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${project.actualProgress}%` }}
              ></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}