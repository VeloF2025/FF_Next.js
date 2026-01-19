/**
 * Maintenance navigation section configuration
 */

import {
  Wrench,
  LayoutDashboard,
  Database,
  AlertTriangle,
  ArrowRightLeft,
  ShieldAlert,
  Users
} from 'lucide-react';
import type { NavSection } from './types';

export const maintenanceSection: NavSection = {
  section: 'MAINTENANCE',
  sectionId: 'maintenance',
  isCollapsible: true,
  items: [
    {
      to: '/maintenance',
      icon: LayoutDashboard,
      label: 'Dashboard',
      shortLabel: 'Dash',
      permissions: [],
    },
    {
      to: '/maintenance/tickets',
      icon: Wrench,
      label: 'Work Orders',
      shortLabel: 'Orders',
      permissions: [],
    },
    {
      to: '/maintenance/teams',
      icon: Users,
      label: 'Teams',
      shortLabel: 'Teams',
      permissions: [],
    },
    {
      to: '/maintenance/data-sync',
      icon: Database,
      label: 'Data Sync',
      shortLabel: 'Sync',
      permissions: [],
    },
    {
      to: '/maintenance/escalations',
      icon: AlertTriangle,
      label: 'Escalations',
      shortLabel: 'Escal',
      permissions: [],
    },
    {
      to: '/maintenance/handover',
      icon: ArrowRightLeft,
      label: 'Handover Center',
      shortLabel: 'Handover',
      permissions: [],
    },
    {
      to: '/maintenance/risks',
      icon: ShieldAlert,
      label: 'Risk Acceptance',
      shortLabel: 'Risks',
      permissions: [],
    },
  ]
};
