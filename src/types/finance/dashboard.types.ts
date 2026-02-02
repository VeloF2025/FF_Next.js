/**
 * Finance Dashboard Types
 * Aggregated financial data for project finance dashboard
 */

import type { ClientPOSummary } from './client-po.types';
import type { CustomerInvoiceSummary } from './customer-invoice.types';

export type BudgetHealth = 'healthy' | 'warning' | 'critical';

export interface BudgetSummary {
  totalBudget: number;
  committedAmount: number;
  actualAmount: number;
  availableBudget: number;
  utilizationPercent: number;
  health: BudgetHealth;
}

export interface ProcurementSummary {
  totalPOValue: number;
  totalInvoiced: number;
  totalPaid: number;
  poCount: number;
  pendingApprovalCount: number;
}

export interface WeeklyActivity {
  activations: number;
  invoicesGenerated: number;
  paymentsReceived: number;
}

export interface NetPosition {
  totalIncome: number;
  totalExpenses: number;
  margin: number;
  marginPercent: number;
}

export interface RecentTransaction {
  id: string;
  date: string;
  type: 'invoice_created' | 'invoice_sent' | 'payment_received' | 'po_created' | 'expense';
  description: string;
  amount: number;
  reference?: string;
  sourceType?: string;
  sourceId?: string;
}

export interface FinanceDashboardData {
  clientPOs: ClientPOSummary;
  budget: BudgetSummary | null;
  procurement: ProcurementSummary;
  invoices: CustomerInvoiceSummary;
  thisWeek: WeeklyActivity;
  netPosition: NetPosition;
  recentTransactions: RecentTransaction[];
}
