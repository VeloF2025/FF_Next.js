/**
 * Project Management section configuration
 */

import {
  CheckCircle,
  BarChart3,
  LayoutDashboard,
  GitBranch
} from 'lucide-react';
import type { NavSection } from './types';

export const projectSection: NavSection = {
  section: 'PROJECT MANAGEMENT',
  sectionId: 'projects',
  isCollapsible: true,
  items: [
    {
      to: '/projects',
      icon: LayoutDashboard,
      label: 'Projects',
      shortLabel: 'Proj',
      permissions: [],
    },
    {
      to: '/pipeline',
      icon: GitBranch,
      label: 'Pipeline',
      shortLabel: 'Pipe',
      permissions: [],
    },
    {
      to: '/tasks',
      icon: CheckCircle,
      label: 'Task Management',
      shortLabel: 'Tasks',
      permissions: [],
    },
    {
      to: '/daily-progress',
      icon: BarChart3,
      label: 'Daily Progress',
      shortLabel: 'Daily',
      permissions: [],
    },
  ]
};
