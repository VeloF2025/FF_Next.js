/**
 * Project Management section configuration
 */

import {
  CheckCircle,
  BarChart3,
  LayoutDashboard,
  GitBranch,
  Shield,
  Building2,
  Briefcase,
  Activity,
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
      to: '/health-safety',
      icon: Shield,
      label: 'Health & Safety',
      shortLabel: 'H&S',
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
    {
      to: '/clients',
      icon: Building2,
      label: 'Clients',
      shortLabel: 'Clients',
      permissions: [],
    },
    {
      to: '/contractors',
      icon: Briefcase,
      label: 'Contractors',
      shortLabel: 'Contract',
      permissions: [],
    },
    {
      to: '/contractors/rag-dashboard',
      icon: Activity,
      label: 'RAG Dashboard',
      shortLabel: 'RAG',
      permissions: [],
    },
  ]
};
