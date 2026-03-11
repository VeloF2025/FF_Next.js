/**
 * NOC Module Navigation Configuration
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

export const nocConfig: ModuleNavigationConfig = {
  moduleId: 'noc',
  moduleName: 'NOC',
  description: 'Manage maintenance tickets, teams, and operations',
  basePath: '/noc',
  icon: Wrench,
  tabs: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      shortLabel: 'Dash',
      icon: LayoutDashboard,
      path: '/noc',
      rbacKey: 'noc.main',
    },
    {
      id: 'work-orders',
      label: 'Work Orders',
      shortLabel: 'Orders',
      icon: Wrench,
      path: '/noc/tickets',
      rbacKey: 'noc.tickets',
      subTabs: [
        {
          id: 'active',
          label: 'Active',
          icon: Clock,
          path: '/noc/tickets?status=active',
        },
        {
          id: 'completed',
          label: 'Completed',
          icon: CheckCircle,
          path: '/noc/tickets?status=completed',
        },
      ],
    },
    {
      id: 'teams',
      label: 'Teams',
      shortLabel: 'Teams',
      icon: Users,
      path: '/noc/teams',
      rbacKey: 'noc',
    },
    {
      id: 'data-sync',
      label: 'Data Sync',
      shortLabel: 'Sync',
      icon: Database,
      path: '/system/data-sync?group=noc',
      rbacKey: 'noc',
      external: false, // Opens within app but different module
    },
    {
      id: 'escalations',
      label: 'Escalations',
      shortLabel: 'Escal',
      icon: AlertTriangle,
      path: '/noc/escalations',
      rbacKey: 'noc.escalations',
    },
    {
      id: 'handover',
      label: 'Handover',
      shortLabel: 'Handover',
      icon: ArrowRightLeft,
      path: '/noc/handover',
      rbacKey: 'noc',
    },
    {
      id: 'risks',
      label: 'Risk Acceptance',
      shortLabel: 'Risks',
      icon: ShieldAlert,
      path: '/noc/risks',
      rbacKey: 'noc',
    },
  ],
};
