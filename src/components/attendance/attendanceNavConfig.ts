/**
 * AttendanceNav configuration — tab definitions and route resolution.
 *
 * Covers the back-office `/staff/attendance/*` surface:
 *   - /staff/attendance               — today's roster
 *   - /staff/attendance/week          — weekly totals + payroll export
 *   - /staff/attendance/corrections   — supervisor review queue (Phase 1c)
 *   - /staff/attendance/locks         — weekly lock management (Phase 1c)
 */

export type { Tab, DropdownItem, FlyoutSection, NavItem } from '../accounting/accountingNavConfig';
export { isFlyout, isLinkActive } from '../accounting/accountingNavConfig';

import type { Tab } from '../accounting/accountingNavConfig';

export const TABS: Tab[] = [
  {
    id: 'overview',
    label: 'Overview',
    href: '/staff/attendance/overview',
  },
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
  {
    id: 'corrections',
    label: 'Corrections',
    href: '/staff/attendance/corrections',
  },
  {
    id: 'locks',
    label: 'Locks',
    href: '/staff/attendance/locks',
  },
  {
    id: 'cartrack',
    label: 'Cartrack',
    href: '/staff/attendance/cartrack-mapping',
  },
];

export function getActiveTabId(pathname: string): string {
  if (pathname.startsWith('/staff/attendance/overview')) return 'overview';
  if (pathname === '/staff/attendance/week') return 'week';
  if (pathname.startsWith('/staff/attendance/corrections')) return 'corrections';
  if (pathname.startsWith('/staff/attendance/locks')) return 'locks';
  if (pathname.startsWith('/staff/attendance/cartrack-mapping')) return 'cartrack';
  return 'roster';
}
