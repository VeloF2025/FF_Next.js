/**
 * ProcurementNav configuration — tab definitions and route resolution
 */

// Re-export all shared types and utilities from the accounting config
export type { Tab, DropdownItem, FlyoutSection, NavItem } from '../accounting/accountingNavConfig';
export { isFlyout, isLinkActive } from '../accounting/accountingNavConfig';

import type { Tab } from '../accounting/accountingNavConfig';

export const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/procurement' },
  {
    id: 'sourcing', label: 'Sourcing',
    topItems: [
      { label: 'Add a Supplier', href: '/suppliers/new' },
      { label: 'Create BOQ', href: '/procurement/boq/new' },
      { label: 'Create RFQ', href: '/procurement/rfq/new' },
    ],
    items: [
      {
        section: 'Suppliers',
        items: [
          { label: 'Supplier List', href: '/procurement/sourcing?tab=suppliers' },
        ],
      },
      {
        section: 'Bill of Quantities',
        items: [
          { label: 'BOQ List', href: '/procurement/boq' },
          { label: 'BOQ Stock View', href: '/procurement?tab=boq-view' },
        ],
      },
      {
        section: 'Requests for Quote',
        items: [
          { label: 'RFQ List', href: '/procurement/rfq' },
          { label: 'Quote Evaluation', href: '/procurement/quotes' },
        ],
      },
    ],
  },
  {
    id: 'purchasing', label: 'Purchasing',
    topItems: [
      { label: 'New Requisition', href: '/procurement/requisitions/new' },
      { label: 'New Purchase Order', href: '/procurement/purchase-orders/new' },
    ],
    items: [
      {
        section: 'Orders',
        items: [
          { label: 'Requisitions', href: '/procurement/requisitions' },
          { label: 'Purchase Orders', href: '/procurement/purchase-orders' },
          { label: 'Open Orders', href: '/procurement/open-orders' },
          { label: 'Pipelines', href: '/procurement/pipelines' },
        ],
      },
      {
        section: 'Receiving',
        items: [
          { label: 'Goods Received Notes', href: '/procurement/grn' },
          { label: 'New GRN', href: '/procurement/grn/new' },
        ],
      },
      {
        section: 'Workflow',
        items: [
          { label: 'Procurement Workflow', href: '/procurement/workflow' },
        ],
      },
    ],
  },
  {
    id: 'inventory', label: 'Inventory',
    items: [
      {
        section: 'Stock',
        items: [
          { label: 'Stock Management', href: '/procurement/inventory' },
          { label: 'Stock Items', href: '/procurement/stock-items' },
          { label: 'Stock Categories', href: '/procurement/stock-categories' },
          { label: 'Stock Takes', href: '/procurement/stock-takes' },
        ],
      },
      {
        section: 'Field',
        items: [
          { label: 'Field Stock', href: '/procurement/field-stock' },
          { label: 'Bundles', href: '/procurement/bundles' },
        ],
      },
    ],
  },
  { id: 'approvals', label: 'Approvals', href: '/procurement/approvals' },
  { id: 'boq-view', label: 'BOQ View', href: '/procurement?tab=boq-view' },
  {
    id: 'reports', label: 'Reports',
    items: [
      {
        section: 'Reports',
        items: [
          { label: 'Procurement Reports', href: '/procurement/reports' },
          { label: 'BOQ Spend Summary', href: '/procurement/reports?tab=boq-spend' },
          { label: 'Budget Overview', href: '/procurement/budget' },
          { label: 'Audit Trail', href: '/procurement/audit' },
          { label: 'Cost Centers', href: '/procurement/cost-centers' },
          { label: 'Financial Summary', href: '/procurement/financial' },
        ],
      },
    ],
  },
];

export function getActiveTabId(
  pathname: string,
  query: Record<string, string | string[] | undefined>,
): string {
  // BOQ View lives at /procurement?tab=boq-view
  if (pathname === '/procurement' && query.tab === 'boq-view') return 'boq-view';

  // Dashboard — exact match on /procurement with no special query
  if (pathname === '/procurement') return 'dashboard';

  // Sourcing
  if (pathname.startsWith('/procurement/sourcing') ||
      pathname.startsWith('/procurement/boq') ||
      pathname.startsWith('/procurement/rfq') ||
      pathname.startsWith('/procurement/quotes') ||
      pathname.startsWith('/suppliers')) {
    return 'sourcing';
  }

  // Purchasing
  if (pathname.startsWith('/procurement/requisitions') ||
      pathname.startsWith('/procurement/purchase-orders') ||
      pathname.startsWith('/procurement/purchasing') ||
      pathname.startsWith('/procurement/grn') ||
      pathname.startsWith('/procurement/open-orders') ||
      pathname.startsWith('/procurement/pipelines') ||
      pathname.startsWith('/procurement/workflow')) {
    return 'purchasing';
  }

  // Inventory
  if (pathname.startsWith('/procurement/inventory') ||
      pathname.startsWith('/procurement/stock-items') ||
      pathname.startsWith('/procurement/stock-categories') ||
      pathname.startsWith('/procurement/stock-takes') ||
      pathname.startsWith('/procurement/stock') ||
      pathname.startsWith('/procurement/field-stock') ||
      pathname.startsWith('/procurement/bundles')) {
    return 'inventory';
  }

  // Approvals
  if (pathname.startsWith('/procurement/approvals')) return 'approvals';

  // Reports
  if (pathname.startsWith('/procurement/reports') ||
      pathname.startsWith('/procurement/audit') ||
      pathname.startsWith('/procurement/budget') ||
      pathname.startsWith('/procurement/cost-centers') ||
      pathname.startsWith('/procurement/financial')) {
    return 'reports';
  }

  // Suppress unused variable warning — query is accepted for API parity with accounting config
  void query;

  return 'dashboard';
}
