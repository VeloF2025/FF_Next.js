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
      rbacKey: 'projects.list',
    },
    {
      to: '/pipeline',
      icon: GitBranch,
      label: 'Pipeline',
      shortLabel: 'Pipe',
      permissions: [],
      rbacKey: 'projects.pipeline',
    },
    {
      to: '/health-safety',
      icon: Shield,
      label: 'Health & Safety',
      shortLabel: 'H&S',
      permissions: [],
      rbacKey: 'people.health-safety',
    },
    {
      to: '/tasks',
      icon: CheckCircle,
      label: 'Task Management',
      shortLabel: 'Tasks',
      permissions: [],
      rbacKey: 'projects', // Module-level
    },
    {
      to: '/daily-progress',
      icon: BarChart3,
      label: 'Daily Progress',
      shortLabel: 'Daily',
      permissions: [],
      rbacKey: 'dashboard.daily-progress',
    },
    {
      to: '/clients',
      icon: Building2,
      label: 'Clients',
      shortLabel: 'Clients',
      permissions: [],
      rbacKey: 'clients.list',
    },
    {
      to: '/contractors',
      icon: Briefcase,
      label: 'Contractors',
      shortLabel: 'Contract',
      permissions: [],
      rbacKey: 'contractors.list',
    },
    {
      to: '/contractors/rag-dashboard',
      icon: Activity,
      label: 'RAG Dashboard',
      shortLabel: 'RAG',
      permissions: [],
      rbacKey: 'contractors', // Module-level
    },
  ]
};
