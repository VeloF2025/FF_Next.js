/**
 * AttendanceNav configuration — tab definitions and route resolution.
 *
 * Covers the back-office `/staff/attendance/*` surface:
 *   - /staff/attendance         — today's roster
 *   - /staff/attendance/week    — weekly totals + payroll export
 *
 * Phase 1c will add corrections queue and cartrack-mapping.
 */

export type { Tab, DropdownItem, FlyoutSection, NavItem } from '../accounting/accountingNavConfig';
export { isFlyout, isLinkActive } from '../accounting/accountingNavConfig';

import type { Tab } from '../accounting/accountingNavConfig';

export const TABS: Tab[] = [
  {
    id: 'roster',
    label: 'Roster',
    href: '/staff/attendance',
  },
  {
    id: 'week',
    label: 'Weekly',
    href: '/staff/attendance/week',
  },
];

export function getActiveTabId(pathname: string): string {
  if (pathname === '/staff/attendance/week') return 'week';
  return 'roster';
}
