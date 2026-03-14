/**
 * SOWNav configuration — tab definitions and route resolution for the
 * Scope of Work module.
 *
 * All tabs are direct links (no dropdown menus needed — SOW is a simple module).
 */

// Re-export shared types so consumers only need one import.
export type { DropdownItem, FlyoutSection, NavItem, Tab } from '../accounting/accountingNavConfig';
export { isFlyout, isLinkActive } from '../accounting/accountingNavConfig';

import type { Tab } from '../accounting/accountingNavConfig';

// 🟢 WORKING: Tab definitions matching the four SOW pages.
export const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/sow' },
  { id: 'list',      label: 'SOW List',  href: '/sow/list' },
  { id: 'import',    label: 'Import',    href: '/sow/import' },
  { id: 'grid',      label: 'Data Grid', href: '/sow/grid' },
];

/**
 * Resolves the active tab ID from the current Next.js router state.
 *
 * @param pathname - `router.pathname` (e.g. `/sow/list`)
 * @param _query   - `router.query` (unused — SOW has no query-based tab switching)
 */
export function getActiveTabId(
  pathname: string,
  _query: Record<string, string | string[] | undefined>,
): string {
  if (pathname === '/sow') return 'dashboard';
  if (pathname.startsWith('/sow/list'))   return 'list';
  if (pathname.startsWith('/sow/import')) return 'import';
  if (pathname.startsWith('/sow/grid'))   return 'grid';
  return 'dashboard';
}
