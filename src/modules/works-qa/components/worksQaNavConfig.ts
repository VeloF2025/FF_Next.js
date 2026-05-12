/**
 * WorksQANav configuration — tab definitions and route resolution
 *
 * Works QA routes covered:
 *   /field-ops/works-qa   → Overview (pole photo QA dashboard)
 */

// Re-export all shared types and utilities from the accounting config
export type { Tab, DropdownItem, FlyoutSection, NavItem } from '@/components/accounting/accountingNavConfig';
export { isFlyout, isLinkActive } from '@/components/accounting/accountingNavConfig';

import type { Tab } from '@/components/accounting/accountingNavConfig';

export const TABS: Tab[] = [
  { id: 'dashboard', label: 'Overview', href: '/field-ops/works-qa' },
];

export function getActiveTabId(
  pathname: string,
  query: Record<string, string | string[] | undefined>,
): string {
  // Suppress unused variable warning — query is accepted for API parity with other module configs
  void query;

  if (pathname.startsWith('/field-ops/works-qa')) return 'dashboard';

  return 'dashboard';
}
