/**
 * Maintenance Module Navigation Config
 * Tab configuration for the Maintenance module
 */

import {
  LayoutDashboard,
  Wrench,
  Users,
  Database,
  AlertTriangle,
  ArrowRightLeft,
  ShieldAlert,
  Clock,
  CheckCircle,
} from 'lucide-react';
import type { ModuleNavigationConfig } from '../../types';

export const maintenanceConfig: ModuleNavigationConfig = {
  moduleId: 'maintenance',
  moduleName: 'Maintenance',
  description: 'Ticket management, teams, and fault tracking',
  basePath: '/maintenance',
  icon: Wrench,
  tabs: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      shortLabel: 'Home',
      icon: LayoutDashboard,
      path: '/maintenance',
    },
    {
      id: 'work-orders',
      label: 'Work Orders',
      shortLabel: 'Tickets',
      icon: Wrench,
      path: '/maintenance/tickets',
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
      icon: Users,
      path: '/maintenance/teams',
      rbacKey: 'maintenance.teams',
    },
    {
      id: 'data-sync',
      label: 'Data Sync',
      shortLabel: 'Sync',
      icon: Database,
      path: '/maintenance/data-sync',
      rbacKey: 'maintenance.data-sync',
    },
    {
      id: 'escalations',
      label: 'Escalations',
      icon: AlertTriangle,
      path: '/maintenance/escalations',
      rbacKey: 'maintenance.escalations',
    },
    {
      id: 'handover',
      label: 'Handover',
      icon: ArrowRightLeft,
      path: '/maintenance/handover',
      rbacKey: 'maintenance.handover',
    },
    {
      id: 'risks',
      label: 'Risk Acceptance',
      shortLabel: 'Risks',
      icon: ShieldAlert,
      path: '/maintenance/risks',
      rbacKey: 'maintenance.risks',
    },
  ],
};
