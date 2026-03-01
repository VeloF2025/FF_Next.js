/**
 * Main navigation section configuration
 */

import { LayoutDashboard, MessageSquare, CheckCircle } from 'lucide-react';
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
      rbacKey: 'dashboard.main',
    },
    {
      to: '/communications',
      icon: MessageSquare,
      label: 'Communications',
      shortLabel: 'Comms',
      permissions: [],
      rbacKey: 'communications.main',
    },
    {
      to: '/action-items',
      icon: CheckCircle,
      label: 'Action Items',
      shortLabel: 'Actions',
      permissions: [],
      rbacKey: 'dashboard.action-items',
    },
  ]
};