/**
 * FleetNav configuration — tab definitions and route resolution
 *
 * Fleet routes covered:
 *   /fleet                              → Dashboard
 *   /fleet/vehicles                     → Vehicles → List
 *   /fleet/vehicles/[id]                → Vehicles (detail)
 *   /fleet/vehicles/[id]/check-in-history → Vehicles (detail sub-page)
 *   /fleet/portal                       → Vehicles → Portal
 *   /fleet/drivers                      → Operations → Drivers
 *   /fleet/fuel                         → Operations → Fuel
 *   /fleet/maintenance                  → Operations → Maintenance
 *   /fleet/check-in                     → Check-Ins → Check In Now
 *   /fleet/check-in/history             → Check-Ins → History
 *   /fleet/check-in/templates           → Check-Ins → Templates
 *   /fleet/investigation                → Investigation → GPS Investigation
 *   /fleet/investigation/[jobId]        → Investigation (job detail)
 *   /fleet/locations                    → Investigation → Locations
 *   /fleet/analytics                    → Analytics
 */

// Re-export all shared types and utilities from the accounting config
export type { Tab, DropdownItem, FlyoutSection, NavItem } from '../accounting/accountingNavConfig';
export { isFlyout, isLinkActive } from '../accounting/accountingNavConfig';

import type { Tab } from '../accounting/accountingNavConfig';

export const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/fleet' },

  {
    id: 'vehicles',
    label: 'Vehicles',
    topItems: [
      { label: 'Vehicle Portal', href: '/fleet/portal' },
    ],
    items: [
      {
        section: 'Fleet',
        items: [
          { label: 'Vehicle List', href: '/fleet/vehicles' },
          { label: 'Vehicle Portal', href: '/fleet/portal' },
        ],
      },
    ],
  },

  {
    id: 'operations',
    label: 'Operations',
    items: [
      {
        section: 'People',
        items: [
          { label: 'Drivers', href: '/fleet/drivers' },
        ],
      },
      {
        section: 'Costs',
        items: [
          { label: 'Fuel', href: '/fleet/fuel' },
        ],
      },
      {
        section: 'Service',
        items: [
          { label: 'Maintenance', href: '/fleet/maintenance' },
        ],
      },
    ],
  },

  {
    id: 'check-ins',
    label: 'Check-Ins',
    topItems: [
      { label: 'Start a Check-In', href: '/fleet/check-in' },
    ],
    items: [
      {
        section: 'Check-In',
        items: [
          { label: 'Check In Now', href: '/fleet/check-in' },
          { label: 'History', href: '/fleet/check-in/history' },
          { label: 'Templates', href: '/fleet/check-in/templates' },
        ],
      },
    ],
  },

  {
    id: 'investigation',
    label: 'Investigation',
    items: [
      {
        section: 'GPS',
        items: [
          { label: 'GPS Investigation', href: '/fleet/investigation' },
        ],
      },
      {
        section: 'Locations',
        items: [
          { label: 'Authorized Locations', href: '/fleet/locations' },
        ],
      },
    ],
  },

  { id: 'analytics', label: 'Analytics', href: '/fleet/analytics' },
];

export function getActiveTabId(
  pathname: string,
  query: Record<string, string | string[] | undefined>,
): string {
  // Exact match for Dashboard — avoids catching /fleet/* prefixes
  if (pathname === '/fleet') return 'dashboard';

  // Analytics
  if (pathname.startsWith('/fleet/analytics')) return 'analytics';

  // Vehicles — list, detail pages, and vehicle portal
  if (pathname.startsWith('/fleet/vehicles') ||
      pathname.startsWith('/fleet/portal')) {
    return 'vehicles';
  }

  // Operations — drivers, fuel, maintenance
  if (pathname.startsWith('/fleet/drivers') ||
      pathname.startsWith('/fleet/fuel') ||
      pathname.startsWith('/fleet/maintenance')) {
    return 'operations';
  }

  // Check-Ins — all check-in sub-routes
  if (pathname.startsWith('/fleet/check-in')) return 'check-ins';

  // Investigation — GPS jobs and authorized locations
  if (pathname.startsWith('/fleet/investigation') ||
      pathname.startsWith('/fleet/locations')) {
    return 'investigation';
  }

  // Suppress unused variable warning — query is accepted for API parity with other module configs
  void query;

  return 'dashboard';
}
