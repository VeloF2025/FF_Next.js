/**
 * AnalyticsNav configuration — tab definitions and route resolution.
 *
 * Covers root-level analytics/reporting pages:
 *   /analytics, /enhanced-kpis, /kpi-dashboard,
 *   /reports, /reports/progress-today, /reports/weekly-activations,
 *   /daily-progress
 *
 * NOTE: Does NOT match /accounting/reports/* — the accounting module owns that prefix.
 */

// Re-export all shared types and utilities from the accounting config
export type { Tab, DropdownItem, FlyoutSection, NavItem } from '../accounting/accountingNavConfig';
export { isFlyout, isLinkActive } from '../accounting/accountingNavConfig';

import type { Tab } from '../accounting/accountingNavConfig';

// 🟢 WORKING: Tab definitions mapped to actual pages found under pages/
export const TABS: Tab[] = [
  {
    id: 'analytics',
    label: 'Analytics',
    href: '/analytics',
  },
  {
    id: 'kpis',
    label: 'KPIs',
    items: [
      { label: 'Enhanced KPIs', href: '/enhanced-kpis' },
      { label: 'KPI Dashboard', href: '/kpi-dashboard' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    items: [
      { label: 'Reports Hub', href: '/reports' },
      { label: 'Progress Today', href: '/reports/progress-today' },
      { label: 'Weekly Activations', href: '/reports/weekly-activations' },
      { label: 'Daily Progress', href: '/daily-progress' },
    ],
  },
];

/**
 * Resolves the active top-level tab ID from the current route.
 *
 * Intentionally does NOT match /accounting/reports/* so this nav only
 * activates on root-level analytics and reporting pages.
 */
export function getActiveTabId(
  pathname: string,
  query: Record<string, string | string[] | undefined>,
): string {
  // Analytics dashboard — exact match
  if (pathname === '/analytics') return 'analytics';

  // KPI pages
  if (pathname === '/enhanced-kpis' || pathname === '/kpi-dashboard') return 'kpis';

  // Reports — /reports exactly or any sub-route, plus /daily-progress
  // Guard: must start with /reports (not /accounting/reports)
  if (pathname === '/reports' || pathname.startsWith('/reports/')) return 'reports';
  if (pathname === '/daily-progress') return 'reports';

  // Suppress unused variable warning — query accepted for API parity
  void query;

  return 'analytics';
}
