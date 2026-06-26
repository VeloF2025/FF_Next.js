/**
 * Planning section configuration
 *
 * Single entry point for project planning and kanban board.
 */

import { ClipboardList } from 'lucide-react';
import type { NavSection } from './types';

export const planningSection: NavSection = {
  section: 'Planning',
  sectionId: 'planning',
  sectionLink: '/planning',
  isCollapsible: false,
  items: [
    {
      to: '/planning',
      icon: ClipboardList,
      label: 'Planning',
      shortLabel: 'Plan',
      permissions: [],
      rbacKey: 'planning.main',
    },
  ],
};
