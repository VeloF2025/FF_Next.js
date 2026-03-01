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
  ShoppingCart,
  Package,
  Camera,
} from 'lucide-react';
import type { NavItem } from '../types';

// Dashboard is always pinned and not in this list
export const DASHBOARD_ITEM: NavItem = {
  to: '/dashboard',
  icon: LayoutDashboard,
  label: 'Dashboard',
  shortLabel: 'Dash',
  permissions: [],
  rbacKey: 'dashboard.main',
};

// Map of item IDs to their NavItem definitions
// These can be selected by users for their MAIN section
export const CUSTOMIZABLE_ITEMS: Record<string, NavItem> = {
  'meetings': {
    to: '/communications?tab=meetings',
    icon: Users,
    label: 'Meetings',
    shortLabel: 'Meet',
    permissions: [],
    rbacKey: 'people.meetings',
  },
  'action-items': {
    to: '/action-items',
    icon: CheckCircle,
    label: 'Action Items',
    shortLabel: 'Actions',
    permissions: [],
    rbacKey: 'dashboard.action-items',
  },
  'tasks': {
    to: '/tasks',
    icon: CheckCircle,
    label: 'Task Management',
    shortLabel: 'Tasks',
    permissions: [],
    rbacKey: 'projects',
  },
  'projects': {
    to: '/projects',
    icon: LayoutDashboard,
    label: 'Projects',
    shortLabel: 'Proj',
    permissions: [],
    rbacKey: 'projects.list',
  },
  'maintenance': {
    to: '/maintenance',
    icon: Ticket,
    label: 'Maintenance',
    shortLabel: 'Maint',
    permissions: [],
    rbacKey: 'maintenance.main',
  },
  'analytics': {
    to: '/analytics',
    icon: BarChart3,
    label: 'Analytics',
    shortLabel: 'Analytics',
    permissions: [],
    rbacKey: 'analytics.main',
  },
  'fleet': {
    to: '/fleet',
    icon: Car,
    label: 'Fleet Dashboard',
    shortLabel: 'Fleet',
    permissions: [],
    rbacKey: 'fleet.main',
  },
  'staff': {
    to: '/staff',
    icon: UserCircle,
    label: 'Staff',
    shortLabel: 'Staff',
    permissions: [],
    rbacKey: 'people.staff',
  },
  'contractors': {
    to: '/contractors',
    icon: HardHat,
    label: 'Contractors',
    shortLabel: 'Contract',
    permissions: [],
    rbacKey: 'contractors.list',
  },
  'wa-monitor': {
    to: '/wa-monitor',
    icon: MessageSquare,
    label: 'WA Monitor',
    shortLabel: 'WA',
    permissions: [],
    rbacKey: 'field',
  },
  'daily-progress': {
    to: '/daily-progress',
    icon: BarChart3,
    label: 'Daily Progress',
    shortLabel: 'Daily',
    permissions: [],
    rbacKey: 'dashboard.daily-progress',
  },
  'clients': {
    to: '/clients',
    icon: Users,
    label: 'Clients',
    shortLabel: 'Clients',
    permissions: [],
    rbacKey: 'clients.list',
  },
  'procurement': {
    to: '/procurement',
    icon: ShoppingCart,
    label: 'Procurement',
    shortLabel: 'Procure',
    permissions: [],
    rbacKey: 'procurement.main',
  },
  'assets': {
    to: '/assets',
    icon: Package,
    label: 'Assets',
    shortLabel: 'Assets',
    permissions: [],
    rbacKey: 'assets',
  },
  'communications': {
    to: '/communications',
    icon: MessageSquare,
    label: 'Communications Hub',
    shortLabel: 'Comms',
    permissions: [],
    rbacKey: 'communications.main',
  },
  'activate': {
    to: '/activate',
    icon: Camera,
    label: 'Activate',
    shortLabel: 'Activate',
    permissions: [],
    rbacKey: 'activate.main',
  },
};

// Legacy ID remapping: users who had 'meetings' pinned now get 'communications'
const LEGACY_REMAP: Record<string, string> = {
  'meetings': 'communications',
};

/**
 * Build the MAIN section items based on user preferences
 * @param selectedItemIds - Array of item IDs selected by the user
 * @returns Array of NavItems for the MAIN section (always starts with Dashboard)
 */
export function buildMainSectionItems(selectedItemIds: string[]): NavItem[] {
  const items: NavItem[] = [DASHBOARD_ITEM];
  const seen = new Set<string>();

  for (const id of selectedItemIds) {
    const resolvedId = LEGACY_REMAP[id] || id;
    if (seen.has(resolvedId)) continue;
    seen.add(resolvedId);
    const item = CUSTOMIZABLE_ITEMS[resolvedId];
    if (item) {
      items.push(item);
    }
  }

  return items;
}
