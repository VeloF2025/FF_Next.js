/**
 * Project Management section configuration
 */

import {
  FolderKanban,
  Building2,
  Briefcase,
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
    // Pipeline and Health & Safety are now tabs within /projects
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
