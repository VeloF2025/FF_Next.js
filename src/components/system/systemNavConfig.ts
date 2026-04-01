/**
 * SystemNav configuration — tab definitions and route resolution.
 *
 * Covers: Health, Deployment, Infrastructure, Data Sync, VLM Learning,
 * Data Management (sub-pages), and Settings.
 */

// Re-export all shared types and utilities from the accounting config
export type { Tab, DropdownItem, FlyoutSection, NavItem } from '../accounting/accountingNavConfig';
export { isFlyout, isLinkActive } from '../accounting/accountingNavConfig';

import type { Tab } from '../accounting/accountingNavConfig';

export const TABS: Tab[] = [
  { id: 'health', label: 'Health', href: '/system/health' },
  { id: 'deployment', label: 'Deployment', href: '/deployment' },
  { id: 'infrastructure', label: 'Infrastructure', href: '/system/infrastructure' },
  { id: 'data-sync', label: 'Data Sync', href: '/system/data-sync' },
  { id: 'vlm', label: 'VLM Learning', href: '/system/vlm-learning' },
  {
    id: 'data-management',
    label: 'Data Management',
    items: [
      { label: 'Document Expiry', href: '/system/data-management/document-expiry' },
      { label: 'OLT Report', href: '/system/data-management/olt-report' },
    ],
  },
  { id: 'settings', label: 'Settings', href: '/settings' },
];

export function getActiveTabId(
  pathname: string,
  query: Record<string, string | string[] | undefined>,
): string {
  if (pathname === '/system/health' || pathname.startsWith('/system/health/')) return 'health';
  if (pathname === '/deployment' || pathname.startsWith('/deployment/')) return 'deployment';
  if (pathname === '/system/infrastructure' || pathname.startsWith('/system/infrastructure/')) return 'infrastructure';
  if (pathname === '/system/data-sync' || pathname.startsWith('/system/data-sync/')) return 'data-sync';
  if (pathname === '/system/vlm-learning' || pathname.startsWith('/system/vlm-learning/')) return 'vlm';
  if (pathname.startsWith('/system/data-management/')) return 'data-management';
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'settings';

  // Suppress unused variable warning — query is accepted for API parity with accounting config
  void query;

  return 'health';
}
