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
    id: 'revenue-overview',
    name: 'Cashflow Overview',
    description: 'Monthly Cash In, Cash Out and Net from the Shareholder Model',
    category: 'financial',
  },
  {
    id: 'project-revenue',
    name: 'Project Revenue',
    description: 'Projected FC Activation count per project from the Shareholder Model',
    category: 'financial',
  },
  {
    id: 'expense-pivot',
    name: 'Expense Pivot',
    description: 'Monthly expense breakdown by category — mirrors Excel pivot',
    category: 'financial',
  },
  {
    id: 'project-fin',
    name: 'Project COS/Rev \u2014 Forecast',
    description: 'Project-level cost, revenue and net by month from the Shareholder Model',
    category: 'financial',
  },
  {
    id: 'project-detail',
    name: 'Project Detail',
    description: 'Per-project COS breakdown and financial summary with project slicer',
    category: 'financial',
  },
];
