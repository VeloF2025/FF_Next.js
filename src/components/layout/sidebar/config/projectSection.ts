/**
 * Project Management section configuration
 */

import {
  FolderKanban,
  Building2,
  Briefcase,
  GitBranch,
  ShieldCheck,
} from 'lucide-react';
import type { NavSection } from './types';

export const projectSection: NavSection = {
  section: 'PROJECT MANAGEMENT',
  sectionId: 'projects',
  isCollapsible: true,
  items: [
    {
      to: '/projects',
      icon: FolderKanban,
      label: 'Projects',
      shortLabel: 'Proj',
      permissions: [],
      rbacKey: 'projects.list',
    },
    {
      to: '/pipeline',
      icon: GitBranch,
      label: 'Pipeline',
      shortLabel: 'Pipeline',
      permissions: [],
      rbacKey: 'pipeline.list',
    },
    {
      to: '/health-safety',
      icon: ShieldCheck,
      label: 'Health & Safety',
      shortLabel: 'H&S',
      permissions: [],
      rbacKey: 'health-safety.list',
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
  ]
};
