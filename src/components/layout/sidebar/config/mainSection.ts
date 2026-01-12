/**
 * Main navigation section configuration
 */

import { LayoutDashboard, Users, CheckCircle } from 'lucide-react';
import type { NavSection } from './types';

export const mainSection: NavSection = {
  section: 'MAIN',
  sectionId: 'main',
  isCollapsible: true,
  defaultExpanded: true,
  items: [
    {
      to: '/dashboard',
      icon: LayoutDashboard,
      label: 'Dashboard',
      shortLabel: 'Dash',
      permissions: [], // Available to all
    },
    {
      to: '/meetings',
      icon: Users,
      label: 'Meetings',
      shortLabel: 'Meet',
      permissions: [],
    },
    {
      to: '/action-items',
      icon: CheckCircle,
      label: 'Action Items',
      shortLabel: 'Actions',
      permissions: [],
    },
  ]
};