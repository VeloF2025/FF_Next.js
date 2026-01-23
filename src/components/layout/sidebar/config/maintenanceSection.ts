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
      rbacKey: 'maintenance.main',
    },
    {
      to: '/maintenance/tickets',
      icon: Wrench,
      label: 'Work Orders',
      shortLabel: 'Orders',
      permissions: [],
      rbacKey: 'maintenance.tickets',
    },
    {
      to: '/maintenance/teams',
      icon: Users,
      label: 'Teams',
      shortLabel: 'Teams',
      permissions: [],
      rbacKey: 'maintenance',
    },
    {
      to: '/maintenance/data-sync',
      icon: Database,
      label: 'Data Sync',
      shortLabel: 'Sync',
      permissions: [],
      rbacKey: 'maintenance',
    },
    {
      to: '/maintenance/escalations',
      icon: AlertTriangle,
      label: 'Escalations',
      shortLabel: 'Escal',
      permissions: [],
      rbacKey: 'maintenance.escalations',
    },
    {
      to: '/maintenance/handover',
      icon: ArrowRightLeft,
      label: 'Handover Center',
      shortLabel: 'Handover',
      permissions: [],
      rbacKey: 'maintenance',
    },
    {
      to: '/maintenance/risks',
      icon: ShieldAlert,
      label: 'Risk Acceptance',
      shortLabel: 'Risks',
      permissions: [],
      rbacKey: 'maintenance',
    },
  ]
};
