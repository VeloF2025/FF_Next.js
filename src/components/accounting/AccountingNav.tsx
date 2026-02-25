/**
 * Sage-style horizontal navigation bar for accounting pages
 * Tabs with dropdown menus, active state based on current route
 */

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

interface DropdownItem {
  label: string;
  href: string;
}

interface Tab {
  id: string;
  label: string;
  href?: string;
  items?: DropdownItem[];
}

const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/accounting' },
  {
    id: 'customers', label: 'Customers',
    items: [
      { label: 'Tax Invoices', href: '/accounting/customer-invoices' },
      { label: 'Recurring Invoices', href: '/accounting/recurring-invoices' },
      { label: 'Receipts', href: '/accounting/customer-payments' },
      { label: 'Credit Notes', href: '/accounting/credit-notes' },
      { label: 'Write-Offs', href: '/accounting/write-offs' },
      { label: 'Adjustments', href: '/accounting/adjustments?type=customer' },
      { label: 'Aging', href: '/accounting/ar-aging' },
      { label: 'Statements', href: '/accounting/customer-statements' },
    ],
  },
  {
    id: 'suppliers', label: 'Suppliers',
    items: [
      { label: 'Invoices', href: '/accounting/supplier-invoices' },
      { label: 'Payments', href: '/accounting/supplier-payments' },
      { label: 'Batch Payments', href: '/accounting/batch-payments' },
      { label: 'Returns', href: '/accounting/supplier-returns' },
      { label: 'Adjustments', href: '/accounting/adjustments?type=supplier' },
      { label: 'Aging', href: '/accounting/ap-aging' },
    ],
  },
  {
    id: 'banking', label: 'Banking',
    items: [
      { label: 'Bank Accounts', href: '/accounting/bank-accounts' },
      { label: 'Transactions', href: '/accounting/bank-transactions' },
      { label: 'Import Statement', href: '/accounting/bank-reconciliation/import' },
      { label: 'Reconcile', href: '/accounting/bank-reconciliation' },
      { label: 'Mapping Rules', href: '/accounting/bank-reconciliation/rules' },
      { label: 'Transfers', href: '/accounting/bank-transfers' },
    ],
  },
  {
    id: 'accounts', label: 'Accounts',
    items: [
      { label: 'Chart of Accounts', href: '/accounting/chart-of-accounts' },
      { label: 'Journal Entries', href: '/accounting/journal-entries' },
      { label: 'Recurring Journals', href: '/accounting/recurring-journals' },
      { label: 'Fiscal Periods', href: '/accounting/fiscal-periods' },
      { label: 'Default Accounts', href: '/accounting/default-accounts' },
    ],
  },
  {
    id: 'vat', label: 'VAT',
    items: [
      { label: 'VAT Return', href: '/accounting/reports/vat-return' },
      { label: 'VAT Adjustments', href: '/accounting/vat-adjustments' },
      { label: 'DRC VAT', href: '/accounting/drc-vat' },
    ],
  },
  {
    id: 'accountants', label: "Accountant's Area",
    items: [
      { label: 'Trial Balance', href: '/accounting/trial-balance' },
      { label: 'Opening Balances', href: '/accounting/opening-balances' },
      { label: 'Depreciation', href: '/accounting/depreciation' },
      { label: 'Year-End', href: '/accounting/year-end' },
      { label: 'Audit Trail', href: '/accounting/reports/audit-trail' },
      { label: 'Cost Centres', href: '/accounting/cost-centres' },
      { label: 'Budgets', href: '/accounting/budgets' },
    ],
  },
  {
    id: 'reports', label: 'Reports',
    items: [
      { label: 'Income Statement', href: '/accounting/reports/income-statement' },
      { label: 'Balance Sheet', href: '/accounting/reports/balance-sheet' },
      { label: 'Cash Flow', href: '/accounting/reports/cash-flow' },
      { label: 'Budget vs Actual', href: '/accounting/reports/budget-vs-actual' },
      { label: 'Project Profitability', href: '/accounting/reports/project-profitability' },
      { label: 'Customer Report', href: '/accounting/reports/customer-reports' },
      { label: 'Supplier Report', href: '/accounting/reports/supplier-reports' },
      { label: 'Bank Transactions', href: '/accounting/reports/bank-transactions' },
      { label: 'Account Transactions', href: '/accounting/reports/account-transactions' },
    ],
  },
  { id: 'import', label: 'Data Import', href: '/accounting/sage-migration' },
];

function getActiveTabId(pathname: string, query: Record<string, string | string[] | undefined>): string {
  if (pathname === '/accounting') return 'dashboard';
  if (pathname.startsWith('/accounting/sage-migration')) return 'import';

  if (pathname.startsWith('/accounting/customer-') ||
      pathname.startsWith('/accounting/recurring-invoices') ||
      pathname.startsWith('/accounting/credit-notes') ||
      pathname.startsWith('/accounting/write-offs') ||
      pathname.startsWith('/accounting/ar-aging') ||
      (pathname.startsWith('/accounting/adjustments') && query.type === 'customer')) {
    return 'customers';
  }
  if (pathname.startsWith('/accounting/supplier-') ||
      pathname.startsWith('/accounting/batch-payments') ||
      pathname.startsWith('/accounting/ap-aging') ||
      (pathname.startsWith('/accounting/adjustments') && query.type === 'supplier')) {
    return 'suppliers';
  }
  if (pathname.startsWith('/accounting/bank-')) return 'banking';
  if (pathname.startsWith('/accounting/chart-of-accounts') ||
      pathname.startsWith('/accounting/journal-entries') ||
      pathname.startsWith('/accounting/recurring-journals') ||
      pathname.startsWith('/accounting/fiscal-periods') ||
      pathname.startsWith('/accounting/default-accounts')) {
    return 'accounts';
  }
  if (pathname.startsWith('/accounting/vat-') ||
      pathname.startsWith('/accounting/drc-vat') ||
      pathname === '/accounting/reports/vat-return') {
    return 'vat';
  }
  if (pathname.startsWith('/accounting/trial-balance') ||
      pathname.startsWith('/accounting/opening-balances') ||
      pathname.startsWith('/accounting/depreciation') ||
      pathname.startsWith('/accounting/year-end') ||
      pathname.startsWith('/accounting/cost-centres') ||
      pathname.startsWith('/accounting/budgets') ||
      pathname === '/accounting/reports/audit-trail') {
    return 'accountants';
  }
  if (pathname.startsWith('/accounting/reports')) return 'reports';
  return 'dashboard';
}

export function AccountingNav() {
  const router = useRouter();
  const [openTab, setOpenTab] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const activeTab = getActiveTabId(router.pathname, router.query);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenTab(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => { setOpenTab(null); }, [router.pathname]);

  return (
    <nav ref={navRef} className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] relative z-30">
      <div className="flex items-center gap-0 px-2">
        {TABS.map(tab => (
          <div key={tab.id} className="relative">
            {tab.href ? (
              <Link href={tab.href}
                className={`block px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}>
                {tab.label}
              </Link>
            ) : (
              <button
                onClick={() => setOpenTab(openTab === tab.id ? null : tab.id)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors inline-flex items-center gap-1 ${
                  activeTab === tab.id
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}>
                {tab.label}
                <ChevronDown className={`h-3 w-3 transition-transform ${openTab === tab.id ? 'rotate-180' : ''}`} />
              </button>
            )}

            {tab.items && openTab === tab.id && (
              <div className="absolute top-full left-0 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-b-lg shadow-xl min-w-[200px] py-1 z-40">
                {tab.items.map(item => {
                  const itemPath = item.href.split('?')[0];
                  const isActive = router.asPath.startsWith(itemPath) &&
                    (item.href.includes('?') ? router.asPath.includes(item.href.split('?')[1]) : true);
                  return (
                    <Link key={item.href} href={item.href}
                      className={`block px-4 py-2 text-sm transition-colors ${
                        isActive
                          ? 'text-emerald-400 bg-emerald-500/10'
                          : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-primary)]'
                      }`}>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}
