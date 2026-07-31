/**
 * Project Management section configuration
 */

import {
  FolderKanban,
  Building2,
  Briefcase,
  MapPin,
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
    // Pipeline is a tab within /projects. Health & Safety moved to its own
    // top-level section on 2026-07-31 (see healthSafetySection).
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
      to: '/fno-atlas',
      icon: MapPin,
      label: 'FNO Atlas',
      shortLabel: 'FNOs',
      permissions: [],
      rbacKey: 'projects.list',
    },
  ]
};
