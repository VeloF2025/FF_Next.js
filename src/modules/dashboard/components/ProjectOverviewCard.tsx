'use client';

import { useState, useEffect } from 'react';
import { FolderOpen, Calendar, MapPin, Users, Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/utils/cn';
import { ProjectQueryService } from '@/services/projects/core/projectQueryService';
import { Project } from '@/types/project.types';
import { log } from '@/lib/logger';
import { formatDisplayDateShort } from '@/utils/dateFormat';

interface DisplayProject {
  id: string;
  name: string;
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  progress: number;
  startDate: string;
  endDate: string;
  location: string;
  teamSize: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  tasksCompleted: number;
  totalTasks: number;
}

interface ProjectOverviewCardProps {
  projects?: DisplayProject[];
  isLoading?: boolean;
  className?: string;
}

const statusConfig = {
  planning: {
    label: 'Planning',
    color: 'bg-info-100 text-info-800 border-info-200',
    dot: 'bg-info-500',
  },
  active: {
    label: 'Active',
    color: 'bg-success-100 text-success-800 border-success-200',
    dot: 'bg-success-500',
  },
  on_hold: {
    label: 'On Hold',
    color: 'bg-warning-100 text-warning-800 border-warning-200',
    dot: 'bg-warning-500',
  },
  completed: {
    label: 'Completed',
    color: 'bg-neutral-100 text-neutral-800 border-neutral-200',
    dot: 'bg-neutral-500',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'bg-error-100 text-error-800 border-error-200',
    dot: 'bg-error-500',
  },
};

// Helper function to format location from various data types
function formatLocation(location: any): string {
  if (!location) return 'Unknown';
  
  // Already a string
  if (typeof location === 'string') {
    // Check if it's a JSON string
    try {
      const parsed = JSON.parse(location);
      return formatLocation(parsed);
    } catch {
      return location || 'Unknown';
    }
  }
  
  // It's an object with city/province/region
  if (typeof location === 'object') {
    const parts: string[] = [];
    
    if (location.city) parts.push(location.city);
    if (location.region && location.region !== location.city) parts.push(location.region);
    if (location.province && location.province !== location.city && location.province !== location.region) {
      parts.push(location.province);
    }
    
    if (parts.length > 0) return parts.join(', ');
    
    // Fallback: if only coordinates, return "Unknown"
    if (location.coordinates) return 'Unknown';
  }
  
  return 'Unknown';
}

// Helper function to map Project to DisplayProject
function mapProjectToDisplay(project: Project): DisplayProject {
  // 🟢 WORKING: Safe date conversion with fallbacks
  const safeDate = (date: any): string => {
    if (!date) return new Date().toISOString();
    if (typeof date === 'string') return date;
    if (date.toDate && typeof date.toDate === 'function') return date.toDate().toISOString();
    return date.toString();
  };

  return {
    id: project.id || '',
    name: project.name || 'Unnamed Project',
    status: project.status || 'planning', // Default to planning if status is missing
    progress: Number(project.actualProgress) || 0,
    startDate: safeDate(project.startDate),
    endDate: safeDate(project.endDate),
    location: formatLocation(project.location),
    teamSize: project.teamMembers?.length || 0,
    priority: project.priority || 'low', // Default to low if priority is missing
    tasksCompleted: 0, // TODO: Connect to task system when available
    totalTasks: 0, // TODO: Connect to task system when available
  };
}

const priorityConfig = {
  low: { color: 'text-success-600', bg: 'bg-success-100' },
  medium: { color: 'text-warning-600', bg: 'bg-warning-100' },
  high: { color: 'text-error-600', bg: 'bg-error-100' },
  critical: { color: 'text-error-700', bg: 'bg-error-200' },
};

// 🟢 WORKING: No mock data - projects loaded from real database

export function ProjectOverviewCard({ 
  projects: providedProjects, 
  isLoading: providedLoading = false,
  className = '' 
}: ProjectOverviewCardProps) {
  const [selectedTab, setSelectedTab] = useState<'all' | 'active' | 'planning'>('all');
  const [projects, setProjects] = useState<DisplayProject[]>(providedProjects || []);
  const [isLoading, setIsLoading] = useState(providedLoading);
  
  // 🟢 WORKING: Load real projects from database if not provided
  useEffect(() => {
    if (!providedProjects) {
      loadProjects();
    } else {
      setProjects(providedProjects);
      setIsLoading(providedLoading);
    }
  }, [providedProjects, providedLoading]);
  
  const loadProjects = async () => {
    try {
      setIsLoading(true);
      const realProjects = await ProjectQueryService.getAllProjects();
      // 🟢 WORKING: Safe mapping with error handling for individual projects
      const displayProjects = realProjects.map((project, index) => {
        try {
          return mapProjectToDisplay(project);
        } catch (error) {
          log.error(`Error mapping project at index ${index}:`, { data: error, project }, 'ProjectOverviewCard');
          // Return a safe fallback project
          return {
            id: project?.id || `error-project-${index}`,
            name: project?.name || `Project ${index + 1}`,
            status: 'planning' as const,
            progress: 0,
            startDate: new Date().toISOString(),
            endDate: new Date().toISOString(),
            location: 'Unknown',
            teamSize: 0,
            priority: 'low' as const,
            tasksCompleted: 0,
            totalTasks: 0,
          };
        }
      });
      setProjects(displayProjects);
    } catch (error) {
      log.error('Error loading projects:', { data: error }, 'ProjectOverviewCard');
      setProjects([]); // Show empty state on error
    } finally {
      setIsLoading(false);
    }
  };

  const filteredProjects = projects.filter(project => {
    if (selectedTab === 'all') return true;
    return project.status === selectedTab;
  });

  const formatDate = (dateString: string) => {
    return formatDisplayDateShort(dateString);
  };

  const getDaysRemaining = (endDate: string) => {
    const end = new Date(endDate);
    const now = new Date();
    const diffTime = end.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  if (isLoading) {
    return (
      <div className={cn(
        'bg-[var(--ff-surface-primary)] rounded-lg border border-[var(--ff-border-primary)] p-6',
        className
      )}>
        <div className="animate-pulse">
          <div className="h-4 bg-[var(--ff-surface-secondary)] rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-[var(--ff-surface-secondary)] rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'bg-[var(--ff-surface-primary)] rounded-lg border border-[var(--ff-border-primary)] p-6',
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <FolderOpen className="w-5 h-5 text-primary-600" />
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Active Projects
          </h3>
        </div>
        
        {/* Tabs */}
        <div className="flex space-x-1 bg-[var(--ff-surface-secondary)] rounded-lg p-1">
          {[
            { key: 'all' as const, label: 'All' },
            { key: 'active' as const, label: 'Active' },
            { key: 'planning' as const, label: 'Planning' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSelectedTab(tab.key)}
              className={cn(
                'px-3 py-1 text-sm font-medium rounded-md transition-colors',
                selectedTab === tab.key
                  ? 'bg-[var(--ff-surface-primary)] text-[var(--ff-text-primary)] shadow-sm'
                  : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Projects List */}
      <div className="space-y-4">
        {filteredProjects.map((project) => {
          // 🟢 WORKING: Defensive programming to handle undefined/null status values
          const status = statusConfig[project.status] || statusConfig['planning']; // Default to planning if status is invalid
          const priority = priorityConfig[project.priority] || priorityConfig['low']; // Default to low if priority is invalid
          const daysRemaining = getDaysRemaining(project.endDate);

          return (
            <div
              key={project.id}
              className="border border-[var(--ff-border-secondary)] rounded-lg p-4 hover:border-[var(--ff-border-primary)] transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-[var(--ff-text-primary)] truncate">
                    {project.name}
                  </h4>
                  <div className="flex items-center space-x-4 mt-1 text-sm text-[var(--ff-text-tertiary)]">
                    <div className="flex items-center space-x-1">
                      <MapPin className="w-3 h-3" />
                      <span>{project.location}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Users className="w-3 h-3" />
                      <span>{project.teamSize} members</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Calendar className="w-3 h-3" />
                      <span>{formatDate(project.endDate)}</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2 ml-4">
                  {/* Priority indicator */}
                  {project.priority === 'high' || project.priority === 'critical' ? (
                    <div className={cn('p-1 rounded', priority.bg)}>
                      <AlertTriangle className={cn('w-3 h-3', priority.color)} />
                    </div>
                  ) : null}
                  
                  {/* Status badge */}
                  <span className={cn(
                    'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border',
                    status.color
                  )}>
                    <div className={cn('w-1.5 h-1.5 rounded-full mr-1', status.dot)} />
                    {status.label}
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--ff-text-secondary)]">
                    Progress: {project.tasksCompleted}/{project.totalTasks} tasks
                  </span>
                  <span className="font-medium text-[var(--ff-text-primary)]">
                    {project.progress}%
                  </span>
                </div>
                <div className="w-full bg-[var(--ff-surface-secondary)] rounded-full h-2">
                  <div
                    className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${project.progress}%` }}
                  />
                </div>
                
                {/* Timeline info */}
                <div className="flex items-center justify-between text-xs text-[var(--ff-text-tertiary)] mt-2">
                  <span>Started {formatDate(project.startDate)}</span>
                  <div className="flex items-center space-x-1">
                    <Clock className="w-3 h-3" />
                    <span>
                      {daysRemaining > 0 
                        ? `${daysRemaining} days remaining`
                        : daysRemaining === 0
                        ? 'Due today'
                        : `${Math.abs(daysRemaining)} days overdue`
                      }
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {filteredProjects.length === 0 && (
        <div className="text-center py-8">
          <FolderOpen className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
          <p className="text-[var(--ff-text-secondary)]">
            {projects.length === 0 
              ? 'No projects found in database' 
              : `No ${selectedTab} projects found`
            }
          </p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            {projects.length === 0 
              ? 'Projects will appear here when added to the system'
              : 'Try selecting a different filter'
            }
          </p>
        </div>
      )}
    </div>
  );
}