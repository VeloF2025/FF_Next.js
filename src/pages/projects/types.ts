/**
 * Projects Page Types
 * Type definitions for projects page components
 */

import { Project, ProjectStatus, ProjectType, Priority } from '@/types/project.types';
import { LucideIcon } from 'lucide-react';

export interface ProjectsPageProps {
  searchTerm?: string;
  initialFilter?: ProjectFilter;
}

export interface ProjectFilter {
  status?: ProjectStatus[];
  projectType?: ProjectType[];
  priority?: Priority[];
  clientId?: string[];
  dateRange?: {
    startDate?: Date;
    endDate?: Date;
  };
}

export interface ProjectSummaryCard {
  title: string;
  value: number;
  icon: LucideIcon;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'indigo';
  trend?: {
    value: number;
    isPositive: boolean;
    label?: string;
  };
  subtitle?: string;
}

export interface ProjectTableColumn {
  key: string;
  header: string;
  render?: (project: Project) => React.ReactNode;
}

export interface ProjectCardProps {
  project: Project;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  formatCurrency: (amount: number) => string;
  formatDate: (timestamp: string | number | Date) => string;
}

export interface ProjectFiltersProps {
  filter: ProjectFilter;
  onUpdateFilter: (updates: Partial<ProjectFilter>) => void;
  onClearFilter: () => void;
  showFilters: boolean;
  onToggleFilters: (show: boolean) => void;
}

export interface ProjectListProps {
  projects: Project[];
  isLoading: boolean;
  viewMode: 'card' | 'table';
  searchTerm: string;
  onProjectView: (id: string) => void;
  onProjectEdit: (id: string) => void;
  onProjectDelete: (id: string) => void;
}

// Status and priority styling
export const statusColors: Record<ProjectStatus, string> = {
  [ProjectStatus.PLANNING]: 'bg-purple-500/20 text-purple-400',
  [ProjectStatus.ACTIVE]: 'bg-green-500/20 text-green-400',
  [ProjectStatus.ON_HOLD]: 'bg-yellow-500/20 text-yellow-400',
  [ProjectStatus.COMPLETED]: 'bg-blue-500/20 text-blue-400',
  [ProjectStatus.CANCELLED]: 'bg-red-500/20 text-red-400',
};

export const priorityColors: Record<Priority, string> = {
  [Priority.LOW]: 'bg-gray-500/20 text-gray-400',
  [Priority.MEDIUM]: 'bg-yellow-500/20 text-yellow-400',
  [Priority.HIGH]: 'bg-orange-500/20 text-orange-400',
  [Priority.CRITICAL]: 'bg-red-500/20 text-red-400',
};