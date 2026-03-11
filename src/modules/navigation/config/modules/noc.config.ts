/**
 * NOC Module Navigation Config
 * Tab configuration for the NOC (Network Operations Centre) module
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

export const nocConfig: ModuleNavigationConfig = {
  moduleId: 'noc',
  moduleName: 'NOC',
  description: 'Network Operations Centre - Ticket management, teams, and fault tracking',
  basePath: '/noc',
  icon: Wrench,
  tabs: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      shortLabel: 'Home',
      icon: LayoutDashboard,
      path: '/noc',
    },
    {
      id: 'work-orders',
      label: 'Work Orders',
      shortLabel: 'Tickets',
      icon: Wrench,
      path: '/noc/tickets',
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
      icon: Users,
      path: '/noc/teams',
      rbacKey: 'noc.teams',
    },
    {
      id: 'data-sync',
      label: 'Data Sync',
      shortLabel: 'Sync',
      icon: Database,
      path: '/noc/data-sync',
      rbacKey: 'noc.data-sync',
    },
    {
      id: 'escalations',
      label: 'Escalations',
      icon: AlertTriangle,
      path: '/noc/escalations',
      rbacKey: 'noc.escalations',
    },
    {
      id: 'handover',
      label: 'Handover',
      icon: ArrowRightLeft,
      path: '/noc/handover',
      rbacKey: 'noc.handover',
    },
    {
      id: 'risks',
      label: 'Risk Acceptance',
      shortLabel: 'Risks',
      icon: ShieldAlert,
      path: '/noc/risks',
      rbacKey: 'noc.risks',
    },
  ],
};
