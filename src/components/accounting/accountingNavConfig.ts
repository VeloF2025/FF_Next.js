/**
 * AccountingNav configuration — tab definitions and route resolution
 */

export interface DropdownItem {
  label: string;
  href: string;
}

export interface FlyoutSection {
  section: string;
  items: NavItem[];
}

export type NavItem = DropdownItem | FlyoutSection;

export function isFlyout(item: NavItem): item is FlyoutSection {
  return 'section' in item;
}

export interface Tab {
  id: string;
  label: string;
  href?: string;
  topItems?: DropdownItem[];
  items?: NavItem[];
}

export const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/accounting' },
  {
    id: 'customers', label: 'Customers',
    topItems: [
      { label: 'Add a Customer', href: '/clients/new' },
    ],
    items: [
      {
        section: 'Lists',
        items: [
          { label: 'List of Customers', href: '/clients' },
          { label: 'Customer Categories', href: '/accounting/customer-categories' },
        ],
      },
      {
        section: 'Transactions',
        items: [
          { label: 'Quotes', href: '/accounting/customer-quotes' },
          { label: 'Tax Invoices', href: '/accounting/customer-invoices' },
          { label: 'Recurring Invoices', href: '/accounting/recurring-invoices' },
          { label: 'Receipts', href: '/accounting/customer-payments' },
          { label: 'Credit Notes', href: '/accounting/credit-notes' },
          { label: 'Write-Offs', href: '/accounting/write-offs' },
          { label: 'Allocate Receipts', href: '/accounting/customer-allocations' },
          { label: 'Adjustments', href: '/accounting/adjustments?type=customer' },
        ],
      },
      {
        section: 'Reports',
        items: [
          { label: 'Sales by Customer', href: '/accounting/reports/sales-by-customer' },
          { label: 'Aging', href: '/accounting/ar-aging' },
          { label: 'Statements', href: '/accounting/customer-statements' },
          { label: 'Unallocated Receipts', href: '/accounting/reports/unallocated-receipts' },
        ],
      },
      {
        section: 'Special',
        items: [
          { label: 'Statement Run', href: '/accounting/statement-run' },
          { label: 'Dunning', href: '/accounting/dunning' },
          { label: 'Opening Balances', href: '/accounting/opening-balances' },
        ],
      },
      {
        section: 'Debtors Manager',
        items: [
          { label: 'Debtors Manager', href: '/accounting/debtors-manager' },
        ],
      },
    ],
  },
  {
    id: 'suppliers', label: 'Suppliers',
    topItems: [
      { label: 'Add a Supplier', href: '/suppliers/new' },
    ],
    items: [
      {
        section: 'Lists',
        items: [
          { label: 'List of Suppliers', href: '/suppliers' },
          { label: 'Supplier Categories', href: '/accounting/supplier-categories' },
        ],
      },
      {
        section: 'Transactions',
        items: [
          { label: 'Purchase Orders', href: '/procurement/purchase-orders' },
          { label: 'Invoices', href: '/accounting/supplier-invoices' },
          { label: 'Returns', href: '/accounting/supplier-returns' },
          { label: 'Payments', href: '/accounting/supplier-payments' },
          { label: 'Batch Payments', href: '/accounting/batch-payments' },
          { label: 'Allocate Payments', href: '/accounting/supplier-allocations' },
          { label: 'Adjustments', href: '/accounting/adjustments?type=supplier' },
        ],
      },
      {
        section: 'Reports',
        items: [
          { label: 'Purchases by Supplier', href: '/accounting/reports/purchases-by-supplier' },
          { label: 'Aging', href: '/accounting/ap-aging' },
          { label: 'Statements', href: '/accounting/supplier-statements' },
          { label: 'Unallocated Payments', href: '/accounting/reports/unallocated-payments' },
        ],
      },
      {
        section: 'Special',
        items: [
          { label: 'Opening Balances', href: '/accounting/opening-balances' },
        ],
      },
    ],
  },
  {
    id: 'items', label: 'Items',
    topItems: [
      { label: 'Add an Item', href: '/stock-items?action=new' },
    ],
    items: [
      {
        section: 'Lists',
        items: [
          { label: 'List of Items', href: '/stock-items' },
          { label: 'Item Categories', href: '/inventory' },
        ],
      },
      {
        section: 'Transactions',
        items: [
          { label: 'Item Adjustments', href: '/accounting/item-adjustments' },
          { label: 'Adjust Selling Prices', href: '/accounting/item-pricing' },
        ],
      },
      {
        section: 'Special',
        items: [
          { label: 'Item Opening Balances', href: '/accounting/item-opening-balances' },
        ],
      },
      {
        section: 'Reports',
        items: [
          { label: 'Item Listing', href: '/accounting/reports/item-listing' },
          { label: 'Sales by Item', href: '/accounting/reports/sales-by-item' },
          { label: 'Purchases by Item', href: '/accounting/reports/purchases-by-item' },
          { label: 'Item Movement', href: '/accounting/reports/item-movement' },
          { label: 'Item Valuation', href: '/accounting/reports/item-valuation' },
          { label: 'Item Quantities', href: '/accounting/reports/item-quantities' },
        ],
      },
    ],
  },
  {
    id: 'banking', label: 'Banking',
    items: [
      {
        section: 'Lists',
        items: [
          { label: 'Bank Accounts', href: '/accounting/bank-accounts' },
        ],
      },
      {
        section: 'Transactions',
        items: [
          { label: 'Transactions', href: '/accounting/bank-transactions' },
          { label: 'Import Statement', href: '/accounting/bank-reconciliation/import' },
          { label: 'Reconcile', href: '/accounting/bank-reconciliation' },
          { label: 'Transfers', href: '/accounting/bank-transfers' },
        ],
      },
      {
        section: 'Special',
        items: [
          { label: 'Mapping Rules', href: '/accounting/bank-reconciliation/rules' },
        ],
      },
    ],
  },
  {
    id: 'accounts', label: 'Accounts',
    items: [
      {
        section: 'Lists',
        items: [
          { label: 'Chart of Accounts', href: '/accounting?tab=chart-of-accounts' },
          { label: 'Default Accounts', href: '/accounting/default-accounts' },
          { label: 'Currencies', href: '/accounting/currencies' },
        ],
      },
      {
        section: 'Transactions',
        items: [
          { label: 'Journal Entries', href: '/accounting?tab=journal-entries' },
          { label: 'Recurring Journals', href: '/accounting/recurring-journals' },
        ],
      },
      {
        section: 'Special',
        items: [
          { label: 'Fiscal Periods', href: '/accounting?tab=fiscal-periods' },
        ],
      },
    ],
  },
  {
    id: 'vat', label: 'VAT',
    items: [
      {
        section: 'Returns',
        items: [
          { label: 'VAT Return', href: '/accounting/reports/vat-return' },
        ],
      },
      {
        section: 'Transactions',
        items: [
          { label: 'VAT Adjustments', href: '/accounting/vat-adjustments' },
          { label: 'DRC VAT', href: '/accounting/drc-vat' },
        ],
      },
    ],
  },
  {
    id: 'accountants', label: "Accountant's Area",
    topItems: [
      { label: 'Process Journal Entries', href: '/accounting?tab=journal-entries' },
      { label: 'Recurring Journal Entries', href: '/accounting/recurring-journals' },
    ],
    items: [
      {
        section: 'VAT',
        items: [
          { label: 'VAT Return', href: '/accounting/reports/vat-return' },
          { label: 'VAT Adjustments', href: '/accounting/vat-adjustments' },
          { label: 'DRC VAT', href: '/accounting/drc-vat' },
        ],
      },
      {
        section: 'Reports',
        items: [
          {
            section: 'Management Reports',
            items: [
              { label: 'Income Statement', href: '/accounting/reports/income-statement' },
              { label: 'Balance Sheet', href: '/accounting/reports/balance-sheet' },
              { label: 'Trial Balance', href: '/accounting/trial-balance' },
              { label: 'Budget vs Actual', href: '/accounting/reports/budget-vs-actual' },
            ],
          },
          {
            section: 'Transaction Reports',
            items: [
              { label: 'Account Transactions', href: '/accounting/reports/account-transactions' },
            ],
          },
          {
            section: 'Audit Reports',
            items: [
              { label: 'Opening Balances', href: '/accounting/opening-balances' },
              { label: 'Audit Trail', href: '/accounting/reports/audit-trail' },
            ],
          },
        ],
      },
      {
        section: 'Transactions',
        items: [
          { label: 'Depreciation', href: '/accounting/depreciation' },
          { label: 'Year-End', href: '/accounting/year-end' },
        ],
      },
      {
        section: 'Management',
        items: [
          { label: 'Cost Centres', href: '/accounting/cost-centres' },
          { label: 'Business Units', href: '/accounting/business-units' },
          { label: 'Budgets', href: '/accounting/budgets' },
        ],
      },
    ],
  },
  {
    id: 'reports', label: 'Reports',
    items: [
      {
        section: 'Financial',
        items: [
          { label: 'Income Statement', href: '/accounting/reports/income-statement' },
          { label: 'Balance Sheet', href: '/accounting/reports/balance-sheet' },
          { label: 'Cash Flow', href: '/accounting/reports/cash-flow' },
        ],
      },
      {
        section: 'Management',
        items: [
          { label: 'Budget vs Actual', href: '/accounting/reports/budget-vs-actual' },
          { label: 'Project Profitability', href: '/accounting/reports/project-profitability' },
        ],
      },
      {
        section: 'Transactional',
        items: [
          { label: 'Customer Report', href: '/accounting/reports/customer-reports' },
          { label: 'Supplier Report', href: '/accounting/reports/supplier-reports' },
          { label: 'Bank Transactions', href: '/accounting/reports/bank-transactions' },
          { label: 'Account Transactions', href: '/accounting/reports/account-transactions' },
        ],
      },
    ],
  },
  { id: 'import', label: 'Data Import', href: '/accounting/sage-migration' },
];

export function getActiveTabId(
  pathname: string,
  query: Record<string, string | string[] | undefined>,
): string {
  if (pathname === '/accounting') {
    if (query.tab === 'chart-of-accounts' || query.tab === 'journal-entries' || query.tab === 'fiscal-periods') {
      return 'accounts';
    }
    return 'dashboard';
  }
  if (pathname.startsWith('/accounting/sage-migration')) return 'import';

  // Customers
  if (pathname.startsWith('/accounting/customer-') ||
      pathname.startsWith('/accounting/recurring-invoices') ||
      pathname.startsWith('/accounting/credit-notes') ||
      pathname.startsWith('/accounting/write-offs') ||
      pathname.startsWith('/accounting/debtors-manager') ||
      pathname.startsWith('/accounting/ar-aging') ||
      pathname.startsWith('/accounting/statement-run') ||
      pathname.startsWith('/accounting/dunning') ||
      pathname === '/accounting/reports/sales-by-customer' ||
      pathname === '/accounting/reports/unallocated-receipts' ||
      pathname.startsWith('/clients') ||
      (pathname.startsWith('/accounting/adjustments') && query.type === 'customer')) {
    return 'customers';
  }

  // Suppliers
  if (pathname.startsWith('/accounting/supplier-') ||
      pathname.startsWith('/accounting/batch-payments') ||
      pathname.startsWith('/accounting/ap-aging') ||
      pathname === '/accounting/reports/purchases-by-supplier' ||
      pathname === '/accounting/reports/unallocated-payments' ||
      (pathname.startsWith('/accounting/adjustments') && query.type === 'supplier')) {
    return 'suppliers';
  }

  // Items
  if (pathname.startsWith('/stock-items') ||
      pathname.startsWith('/inventory') ||
      pathname.startsWith('/accounting/item-') ||
      pathname === '/accounting/reports/item-listing' ||
      pathname === '/accounting/reports/sales-by-item' ||
      pathname === '/accounting/reports/purchases-by-item' ||
      pathname === '/accounting/reports/item-movement' ||
      pathname === '/accounting/reports/item-valuation' ||
      pathname === '/accounting/reports/item-quantities') {
    return 'items';
  }

  // Banking
  if (pathname.startsWith('/accounting/bank-')) return 'banking';

  // Accounts
  if (pathname.startsWith('/accounting/chart-of-accounts') ||
      pathname.startsWith('/accounting/journal-entries') ||
      pathname.startsWith('/accounting/recurring-journals') ||
      pathname.startsWith('/accounting/fiscal-periods') ||
      pathname.startsWith('/accounting/default-accounts') ||
      pathname.startsWith('/accounting/currencies') ||
      pathname.startsWith('/accounting/exchange-rates')) {
    return 'accounts';
  }

  // VAT
  if (pathname.startsWith('/accounting/vat-') ||
      pathname.startsWith('/accounting/drc-vat') ||
      pathname === '/accounting/reports/vat-return') {
    return 'vat';
  }

  // Accountant's Area
  if (pathname.startsWith('/accounting/trial-balance') ||
      pathname.startsWith('/accounting/opening-balances') ||
      pathname.startsWith('/accounting/depreciation') ||
      pathname.startsWith('/accounting/year-end') ||
      pathname.startsWith('/accounting/cost-centres') ||
      pathname.startsWith('/accounting/business-units') ||
      pathname.startsWith('/accounting/budgets') ||
      pathname === '/accounting/reports/audit-trail') {
    return 'accountants';
  }

  if (pathname.startsWith('/accounting/reports')) return 'reports';
  return 'dashboard';
}

export function isLinkActive(href: string, asPath: string): boolean {
  const parts = href.split('?');
  const itemPath = parts[0] as string;
  const qs = parts[1];
  return asPath.startsWith(itemPath) && (!qs || asPath.includes(qs));
}
