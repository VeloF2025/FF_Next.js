/**
 * Maintenance Module Navigation Configuration
 */

import {
  Wrench,
  LayoutDashboard,
  Database,
  AlertTriangle,
  ArrowRightLeft,
  ShieldAlert,
  Users,
  Clock,
  CheckCircle,
} from 'lucide-react';
import type { ModuleNavigationConfig } from '../../types';

export const maintenanceConfig: ModuleNavigationConfig = {
  moduleId: 'maintenance',
  moduleName: 'Maintenance',
  description: 'Manage maintenance tickets, teams, and operations',
  basePath: '/maintenance',
  icon: Wrench,
  tabs: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      shortLabel: 'Dash',
      icon: LayoutDashboard,
      path: '/maintenance',
      rbacKey: 'maintenance.main',
    },
    {
      id: 'work-orders',
      label: 'Work Orders',
      shortLabel: 'Orders',
      icon: Wrench,
      path: '/maintenance/tickets',
      rbacKey: 'maintenance.tickets',
      subTabs: [
        {
          id: 'active',
          label: 'Active',
          icon: Clock,
          path: '/maintenance/tickets?status=active',
        },
        {
          id: 'completed',
          label: 'Completed',
          icon: CheckCircle,
          path: '/maintenance/tickets?status=completed',
        },
      ],
    },
    {
      id: 'teams',
      label: 'Teams',
      shortLabel: 'Teams',
      icon: Users,
      path: '/maintenance/teams',
      rbacKey: 'maintenance',
    },
    {
      id: 'data-sync',
      label: 'Data Sync',
      shortLabel: 'Sync',
      icon: Database,
      path: '/system/data-sync?group=maintenance',
      rbacKey: 'maintenance',
      external: false, // Opens within app but different module
    },
    {
      id: 'escalations',
      label: 'Escalations',
      shortLabel: 'Escal',
      icon: AlertTriangle,
      path: '/maintenance/escalations',
      rbacKey: 'maintenance.escalations',
    },
    {
      id: 'handover',
      label: 'Handover',
      shortLabel: 'Handover',
      icon: ArrowRightLeft,
      path: '/maintenance/handover',
      rbacKey: 'maintenance',
    },
    {
      id: 'risks',
      label: 'Risk Acceptance',
      shortLabel: 'Risks',
      icon: ShieldAlert,
      path: '/maintenance/risks',
      rbacKey: 'maintenance',
    },
  ],
};
