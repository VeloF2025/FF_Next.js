/**
 * Projects Module Navigation Config
 * Tab configuration for the Projects module
 *
 * Consolidates: Pipeline, Tasks, Daily Progress, Health & Safety
 * Keeps separate: Clients, Contractors (different entities)
 */

import {
  FolderKanban,
  LayoutDashboard,
  GitBranch,
  CheckCircle,
  BarChart3,
  Shield,
} from 'lucide-react';
import type { ModuleNavigationConfig } from '../../types';

export const projectsConfig: ModuleNavigationConfig = {
  moduleId: 'projects',
  moduleName: 'Projects',
  description: 'Manage and track fiber optic projects',
  basePath: '/projects',
  icon: FolderKanban,
  tabs: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      shortLabel: 'Dash',
      icon: LayoutDashboard,
      path: '/projects',
    },
    {
      id: 'list',
      label: 'Project List',
      shortLabel: 'List',
      icon: FolderKanban,
      path: '/projects/list',
    },
    {
      id: 'pipeline',
      label: 'Pipeline',
      shortLabel: 'Pipe',
      icon: GitBranch,
      path: '/projects/pipeline',
      rbacKey: 'projects:pipeline:view',
    },
    {
      id: 'tasks',
      label: 'Tasks',
      shortLabel: 'Tasks',
      icon: CheckCircle,
      path: '/projects/tasks',
      rbacKey: 'projects:tasks:view',
    },
    {
      id: 'progress',
      label: 'Daily Progress',
      shortLabel: 'Progress',
      icon: BarChart3,
      path: '/projects/progress',
      rbacKey: 'projects:progress:view',
    },
    {
      id: 'health-safety',
      label: 'Health & Safety',
      shortLabel: 'H&S',
      icon: Shield,
      path: '/projects/health-safety',
      rbacKey: 'projects:health-safety:view',
    },
  ],
};
