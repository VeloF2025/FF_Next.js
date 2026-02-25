/**
 * Accounting section configuration
 *
 * Organized into logical groups matching Sage-style navigation:
 * General Ledger, Accounts Payable, Accounts Receivable, Banking, Reports
 */

import {
  Calculator, BookOpen, FileSpreadsheet, BarChart3,
  Receipt, Wallet, Clock, CreditCard, FileText,
  Landmark, Database, TrendingDown, TrendingUp, Upload,
} from 'lucide-react';
import type { NavSection } from './types';

export const accountingSection: NavSection = {
  section: 'ACCOUNTING',
  sectionId: 'accounting',
  isCollapsible: true,
  defaultExpanded: true,
  items: [
    {
      to: '/accounting',
      icon: Calculator,
      label: 'Overview',
      shortLabel: 'Acct',
      permissions: [],
      rbacKey: 'accounting',
    },
    // ── General Ledger ────────────────────────────────
    {
      to: '#',
      icon: BookOpen,
      label: 'General Ledger',
      shortLabel: 'GL',
      permissions: [],
      rbacKey: 'accounting',
      isGroup: true,
      subItems: [
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
          to: '/accounting?tab=fiscal-periods',
          icon: Clock,
          label: 'Fiscal Periods',
          shortLabel: 'FP',
          permissions: [],
          rbacKey: 'accounting',
        },
      ],
    },
    // ── Accounts Payable ──────────────────────────────
    {
      to: '#',
      icon: TrendingDown,
      label: 'Accounts Payable',
      shortLabel: 'AP',
      permissions: [],
      rbacKey: 'accounting',
      isGroup: true,
      subItems: [
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
          label: 'Supplier Payments',
          shortLabel: 'SPay',
          permissions: [],
          rbacKey: 'accounting',
        },
        {
          to: '/accounting/ap-aging',
          icon: Clock,
          label: 'AP Aging',
          shortLabel: 'APAge',
          permissions: [],
          rbacKey: 'accounting',
        },
      ],
    },
    // ── Accounts Receivable ───────────────────────────
    {
      to: '#',
      icon: TrendingUp,
      label: 'Accounts Receivable',
      shortLabel: 'AR',
      permissions: [],
      rbacKey: 'accounting',
      isGroup: true,
      subItems: [
        {
          to: '/accounting/customer-payments',
          icon: CreditCard,
          label: 'Customer Payments',
          shortLabel: 'CPay',
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
          to: '/accounting/ar-aging',
          icon: Clock,
          label: 'AR Aging',
          shortLabel: 'ARAge',
          permissions: [],
          rbacKey: 'accounting',
        },
      ],
    },
    // ── Banking ───────────────────────────────────────
    {
      to: '#',
      icon: Landmark,
      label: 'Banking',
      shortLabel: 'Bank',
      permissions: [],
      rbacKey: 'accounting',
      isGroup: true,
      subItems: [
        {
          to: '/accounting/bank-reconciliation',
          icon: Landmark,
          label: 'Bank Reconciliation',
          shortLabel: 'Recon',
          permissions: [],
          rbacKey: 'accounting',
        },
        {
          to: '/accounting/bank-reconciliation/import',
          icon: Upload,
          label: 'Import Statement',
          shortLabel: 'Import',
          permissions: [],
          rbacKey: 'accounting',
        },
      ],
    },
    // ── Reports ───────────────────────────────────────
    {
      to: '#',
      icon: BarChart3,
      label: 'Reports',
      shortLabel: 'Reports',
      permissions: [],
      rbacKey: 'accounting',
      isGroup: true,
      subItems: [
        {
          to: '/accounting?tab=reports',
          icon: BarChart3,
          label: 'Trial Balance',
          shortLabel: 'TB',
          permissions: [],
          rbacKey: 'accounting',
        },
        {
          to: '/accounting/reports/income-statement',
          icon: BarChart3,
          label: 'Income Statement',
          shortLabel: 'P&L',
          permissions: [],
          rbacKey: 'accounting',
        },
        {
          to: '/accounting/reports/balance-sheet',
          icon: BarChart3,
          label: 'Balance Sheet',
          shortLabel: 'BS',
          permissions: [],
          rbacKey: 'accounting',
        },
        {
          to: '/accounting/reports/vat-return',
          icon: BarChart3,
          label: 'VAT Return',
          shortLabel: 'VAT',
          permissions: [],
          rbacKey: 'accounting',
        },
        {
          to: '/accounting/reports/project-profitability',
          icon: BarChart3,
          label: 'Project Profitability',
          shortLabel: 'Profit',
          permissions: [],
          rbacKey: 'accounting',
        },
      ],
    },
    // ── Migration ─────────────────────────────────────
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
