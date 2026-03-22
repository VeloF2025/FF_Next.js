/**
 * Analytics Reports Registry
 * Central registry of all available analytics reports.
 * Add new report definitions here and map their components in the client page.
 */

/** Report category types */
export type ReportCategory = 'financial' | 'operational' | 'procurement';

/** Metadata definition for a single analytics report */
export interface ReportDefinition {
  /** Unique report identifier — used as key in REPORT_COMPONENTS map */
  id: string;
  /** Human-readable report name */
  name: string;
  /** Short description shown on the report card */
  description: string;
  /** Logical grouping category */
  category: ReportCategory;
}

// 🟢 WORKING: Registry of all available analytics reports
export const REPORT_REGISTRY: ReportDefinition[] = [
  {
    id: 'income-statement',
    name: 'Income Statement',
    description: 'P&L — Revenue, Cost of Sales, Gross Profit and Net Profit by month',
    category: 'financial',
  },
  {
    id: 'project-profitability',
    name: 'Project Profitability',
    description: 'Revenue vs COS, Gross Profit and Margin per project',
    category: 'financial',
  },
  {
    id: 'revenue-by-client',
    name: 'Revenue by Client',
    description: 'Contract revenue grouped by client from the Data tab',
    category: 'financial',
  },
  {
    id: 'cashflow-statement',
    name: 'Cashflow Statement',
    description: 'Monthly Cash In, Cash Out, Net Movement and Closing Balance',
    category: 'financial',
  },
  {
    id: 'opex',
    name: 'Operational Expenses',
    description: 'Monthly OPEX breakdown by category — from OPEX worksheet',
    category: 'financial',
  },
  {
    id: 'income-expenses',
    name: 'Income / Expenses',
    description: 'Full transaction pivot by category — Expense, Income or All from the Data tab',
    category: 'financial',
  },
  {
    id: 'cos-breakdown',
    name: 'COS Breakdown',
    description: 'Cost of Sales by category — Ad Hoc, Casuals, Fuel, Stock, Sub-Contractor, Wayleaves',
    category: 'financial',
  },
  {
    id: 'assets-register',
    name: 'Assets',
    description: 'Fixed Assets (by category from Data tab) and Current Assets (pre-paid costs, deposits)',
    category: 'financial',
  },
  {
    id: 'opex-vs-capex',
    name: 'OPEX vs CAPEX',
    description: 'Coming soon — operational vs capital expenditure split',
    category: 'financial',
  },
];
