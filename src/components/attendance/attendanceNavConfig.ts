/**
 * Pulse · navigation configuration (PRD-061 §5).
 *
 * Surfaces the back-office attendance area at /staff/attendance/*. The
 * URL slug is preserved verbatim — only the visible label and the
 * sub-tab list change between phases:
 *
 *   - /staff/attendance               — Today's roster (was: Roster)
 *   - /staff/attendance/search        — Cross-staff Search (Phase A, NEW)
 *   - /staff/attendance/week          — Weekly totals + payroll export
 *   - /staff/attendance/corrections   — Supervisor review queue
 *   - /staff/attendance/locks         — Weekly lock management
 *   - /staff/attendance/cartrack-mapping — Vehicle ↔ staff mapping
 *
 * The Overview page (/staff/attendance/overview) remains routable but is
 * not surfaced as a tab — its content folds into the Today header per
 * PRD §5.3 to keep the strip from growing unbounded.
 *
 * Reports (Phase C) and the Pulse top-tab on /staff (PRD §5.2) are added
 * alongside their respective code in later PRs.
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
    label: 'Today',
    href: '/staff/attendance',
  },
  {
    id: 'search',
    label: 'Search',
    href: '/staff/attendance/search',
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
  if (pathname.startsWith('/staff/attendance/search')) return 'search';
  if (pathname === '/staff/attendance/week') return 'week';
  if (pathname.startsWith('/staff/attendance/corrections')) return 'corrections';
  if (pathname.startsWith('/staff/attendance/locks')) return 'locks';
  if (pathname.startsWith('/staff/attendance/cartrack-mapping')) return 'cartrack';
  return 'roster';
}
