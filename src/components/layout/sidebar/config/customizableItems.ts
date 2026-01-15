/**
 * Customizable sidebar items that users can add to their MAIN section
 * These items are pulled from various sections and made available for customization
 */

import {
  LayoutDashboard,
  Users,
  CheckCircle,
  BarChart3,
  Ticket,
  Car,
  UserCircle,
  HardHat,
  MessageSquare,
} from 'lucide-react';
import type { NavItem } from '../types';

// Dashboard is always pinned and not in this list
export const DASHBOARD_ITEM: NavItem = {
  to: '/dashboard',
  icon: LayoutDashboard,
  label: 'Dashboard',
  shortLabel: 'Dash',
  permissions: [],
};

// Map of item IDs to their NavItem definitions
// These can be selected by users for their MAIN section
export const CUSTOMIZABLE_ITEMS: Record<string, NavItem> = {
  'meetings': {
    to: '/meetings',
    icon: Users,
    label: 'Meetings',
    shortLabel: 'Meet',
    permissions: [],
  },
  'action-items': {
    to: '/action-items',
    icon: CheckCircle,
    label: 'Action Items',
    shortLabel: 'Actions',
    permissions: [],
  },
  'tasks': {
    to: '/tasks',
    icon: CheckCircle,
    label: 'Task Management',
    shortLabel: 'Tasks',
    permissions: [],
  },
  'projects': {
    to: '/projects',
    icon: LayoutDashboard,
    label: 'Projects',
    shortLabel: 'Proj',
    permissions: [],
  },
  'ticketing': {
    to: '/ticketing',
    icon: Ticket,
    label: 'Ticketing',
    shortLabel: 'Tickets',
    permissions: [],
  },
  'analytics': {
    to: '/analytics',
    icon: BarChart3,
    label: 'Analytics',
    shortLabel: 'Analytics',
    permissions: [],
  },
  'fleet': {
    to: '/fleet',
    icon: Car,
    label: 'Fleet Dashboard',
    shortLabel: 'Fleet',
    permissions: [],
  },
  'staff': {
    to: '/staff',
    icon: UserCircle,
    label: 'Staff',
    shortLabel: 'Staff',
    permissions: [],
  },
  'contractors': {
    to: '/contractors',
    icon: HardHat,
    label: 'Contractors',
    shortLabel: 'Contract',
    permissions: [],
  },
  'wa-monitor': {
    to: '/wa-monitor',
    icon: MessageSquare,
    label: 'WA Monitor',
    shortLabel: 'WA',
    permissions: [],
  },
  'daily-progress': {
    to: '/daily-progress',
    icon: BarChart3,
    label: 'Daily Progress',
    shortLabel: 'Daily',
    permissions: [],
  },
};

/**
 * Build the MAIN section items based on user preferences
 * @param selectedItemIds - Array of item IDs selected by the user
 * @returns Array of NavItems for the MAIN section (always starts with Dashboard)
 */
export function buildMainSectionItems(selectedItemIds: string[]): NavItem[] {
  const items: NavItem[] = [DASHBOARD_ITEM];

  for (const id of selectedItemIds) {
    const item = CUSTOMIZABLE_ITEMS[id];
    if (item) {
      items.push(item);
    }
  }

  return items;
}
