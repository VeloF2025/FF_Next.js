/**
 * Projects Module Navigation Config
 * Tab configuration for the Projects module with hierarchical sub-tabs
 *
 * Structure:
 * - Dashboard: Portfolio overview
 * - Projects: All/Active/Completed/New
 * - Pipeline: Overview/Authorities/Alerts
 * - Execution: Daily Progress/Tasks/Reports
 * - H&S: Dashboard/Incidents/Checklists
 * - Reports: Analytics
 */

import {
  FolderKanban,
  LayoutDashboard,
  GitBranch,
  CheckCircle,
  BarChart3,
  Shield,
  ListFilter,
  Play,
  CheckCheck,
  Plus,
  Building2,
  AlertTriangle,
  Calendar,
  ListTodo,
  FileText,
  AlertCircle,
  ClipboardCheck,
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
      shortLabel: 'Home',
      icon: LayoutDashboard,
      path: '/projects',
    },
    {
      id: 'projects',
      label: 'Projects',
      shortLabel: 'List',
      icon: FolderKanban,
      path: '/projects/list',
      subTabs: [
        {
          id: 'all',
          label: 'All Projects',
          icon: ListFilter,
          path: '/projects/list',
        },
        {
          id: 'active',
          label: 'Active',
          icon: Play,
          path: '/projects/list?status=active',
        },
        {
          id: 'completed',
          label: 'Completed',
          icon: CheckCheck,
          path: '/projects/list?status=completed',
        },
        {
          id: 'new',
          label: '+ New Project',
          icon: Plus,
          path: '/projects/new',
        },
      ],
    },
    {
      id: 'pipeline',
      label: 'Pipeline',
      shortLabel: 'Pipe',
      icon: GitBranch,
      path: '/projects/pipeline',
      rbacKey: 'projects.pipeline',
      subTabs: [
        {
          id: 'overview',
          label: 'Overview',
          icon: GitBranch,
          path: '/projects/pipeline',
        },
        {
          id: 'authorities',
          label: 'Authorities',
          icon: Building2,
          path: '/projects/pipeline/authorities',
        },
        {
          id: 'alerts',
          label: 'Alerts',
          icon: AlertTriangle,
          path: '/projects/pipeline/alerts',
        },
      ],
    },
    {
      id: 'execution',
      label: 'Execution',
      shortLabel: 'Exec',
      icon: BarChart3,
      path: '/projects/progress',
      rbacKey: 'projects.progress',
      subTabs: [
        {
          id: 'progress-reports',
          label: 'Progress Reports',
          icon: FileText,
          path: '/projects/progress',
        },
        {
          id: 'tasks',
          label: 'Tasks',
          icon: ListTodo,
          path: '/projects/tasks',
        },
        {
          id: 'reports',
          label: 'Progress Reports',
          icon: FileText,
          path: '/projects/progress',
        },
      ],
    },
    {
      id: 'health-safety',
      label: 'Health & Safety',
      shortLabel: 'H&S',
      icon: Shield,
      path: '/projects/health-safety',
      rbacKey: 'projects.health-safety',
      subTabs: [
        {
          id: 'hs-dashboard',
          label: 'Dashboard',
          icon: Shield,
          path: '/projects/health-safety',
        },
        {
          id: 'incidents',
          label: 'Incidents',
          icon: AlertCircle,
          path: '/projects/health-safety/incidents',
        },
        {
          id: 'checklists',
          label: 'Checklists',
          icon: ClipboardCheck,
          path: '/projects/health-safety/checklists',
        },
        {
          id: 'capa',
          label: 'Corrective Actions',
          icon: AlertCircle,
          path: '/projects/health-safety/capa',
        },
        {
          id: 'risks',
          label: 'Risk Register',
          icon: AlertTriangle,
          path: '/projects/health-safety/risks',
        },
      ],
    },
    {
      id: 'reports',
      label: 'Reports',
      shortLabel: 'Reports',
      icon: BarChart3,
      path: '/projects/reports',
      rbacKey: 'projects.reports',
    },
  ],
};
