/**
 * Accounting section configuration
 *
 * General Ledger, Chart of Accounts, Journal Entries, AP, Reports
 */

import { Calculator, BookOpen, FileSpreadsheet, BarChart3, Receipt, Wallet, Clock, CreditCard, FileText, Landmark, Database } from 'lucide-react';
import type { NavSection } from './types';

export const accountingSection: NavSection = {
  section: 'Accounting',
  sectionId: 'accounting',
  sectionLink: '/accounting',
  isCollapsible: true,
  defaultExpanded: false,
  items: [
    {
      to: '/accounting',
      icon: Calculator,
      label: 'Overview',
      shortLabel: 'Acct',
      permissions: [],
      rbacKey: 'accounting',
    },
    {
      to: '/accounting?tab=chart-of-accounts',
      icon: BookOpen,
      label: 'Chart of Accounts',
      shortLabel: 'CoA',
      permissions: [],
      rbacKey: 'accounting',
    },
    {
      to: '/accounting?tab=journal-entries',
      icon: FileSpreadsheet,
      label: 'Journal Entries',
      shortLabel: 'JE',
      permissions: [],
      rbacKey: 'accounting',
    },
    {
      to: '/accounting/supplier-invoices',
      icon: Receipt,
      label: 'Supplier Invoices',
      shortLabel: 'SI',
      permissions: [],
      rbacKey: 'accounting',
    },
    {
      to: '/accounting/supplier-payments',
      icon: Wallet,
      label: 'Payments',
      shortLabel: 'Pay',
      permissions: [],
      rbacKey: 'accounting',
    },
    {
      to: '/accounting/ap-aging',
      icon: Clock,
      label: 'AP Aging',
      shortLabel: 'Aging',
      permissions: [],
      rbacKey: 'accounting',
    },
    {
      to: '/accounting/customer-payments',
      icon: CreditCard,
      label: 'Customer Payments',
      shortLabel: 'CPay',
      permissions: [],
      rbacKey: 'accounting',
    },
    {
      to: '/accounting/ar-aging',
      icon: Clock,
      label: 'AR Aging',
      shortLabel: 'AR',
      permissions: [],
      rbacKey: 'accounting',
    },
    {
      to: '/accounting/credit-notes',
      icon: FileText,
      label: 'Credit Notes',
      shortLabel: 'CN',
      permissions: [],
      rbacKey: 'accounting',
    },
    {
      to: '/accounting/bank-reconciliation',
      icon: Landmark,
      label: 'Bank Recon',
      shortLabel: 'Recon',
      permissions: [],
      rbacKey: 'accounting',
    },
    {
      to: '/accounting?tab=reports',
      icon: BarChart3,
      label: 'Reports',
      shortLabel: 'Reports',
      permissions: [],
      rbacKey: 'accounting',
    },
    {
      to: '/accounting/sage-migration',
      icon: Database,
      label: 'Sage Migration',
      shortLabel: 'Migrate',
      permissions: [],
      rbacKey: 'accounting',
    },
  ],
};
