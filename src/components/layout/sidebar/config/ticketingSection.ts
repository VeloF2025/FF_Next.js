/**
 * Ticketing navigation section configuration
 */

import {
  Ticket,
  LayoutDashboard,
  FileUp,
  RefreshCw,
  AlertTriangle,
  ArrowRightLeft,
  ShieldAlert,
  Users
} from 'lucide-react';
import type { NavSection } from './types';

export const ticketingSection: NavSection = {
  section: 'TICKETING',
  sectionId: 'ticketing',
  isCollapsible: true,
  items: [
    {
      to: '/ticketing',
      icon: LayoutDashboard,
      label: 'Ticketing Dashboard',
      shortLabel: 'Dash',
      permissions: [],
    },
    {
      to: '/ticketing/tickets',
      icon: Ticket,
      label: 'Tickets',
      shortLabel: 'Tickets',
      permissions: [],
    },
    {
      to: '/ticketing/teams',
      icon: Users,
      label: 'Teams',
      shortLabel: 'Teams',
      permissions: [],
    },
    {
      to: '/ticketing/import',
      icon: FileUp,
      label: 'Weekly Import',
      shortLabel: 'Import',
      permissions: [],
    },
    {
      to: '/ticketing/sync',
      icon: RefreshCw,
      label: 'QContact Sync',
      shortLabel: 'Sync',
      permissions: [],
    },
    {
      to: '/ticketing/escalations',
      icon: AlertTriangle,
      label: 'Escalations',
      shortLabel: 'Escal',
      permissions: [],
    },
    {
      to: '/ticketing/handover',
      icon: ArrowRightLeft,
      label: 'Handover Center',
      shortLabel: 'Handover',
      permissions: [],
    },
    {
      to: '/ticketing/risks',
      icon: ShieldAlert,
      label: 'Risk Acceptance',
      shortLabel: 'Risks',
      permissions: [],
    },
  ]
};
