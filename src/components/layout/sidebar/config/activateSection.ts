/**
 * Activate section configuration
 * Top-level section for DR photo QA and activation management
 */

import { LayoutDashboard, ClipboardCheck } from 'lucide-react';
import type { NavSection } from './types';

export const activateSection: NavSection = {
  section: 'ACTIVATE',
  sectionId: 'activate',
  isCollapsible: true,
  items: [
    {
      to: '/activate',
      icon: LayoutDashboard,
      label: 'Dashboard',
      shortLabel: 'Dash',
      permissions: [],
    },
    {
      to: '/activate/qa-centre',
      icon: ClipboardCheck,
      label: 'QA Centre',
      shortLabel: 'QA',
      permissions: [],
    },
  ],
};
