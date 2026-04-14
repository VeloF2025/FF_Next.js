/**
 * Financial Analytics Service
 * Handles financial reporting and cash flow analysis
 */

import { analyticsApi } from '@/services/api/analyticsApi';
import type { FinancialOverview, CashFlowTrend } from './types';
import { log } from '@/lib/logger';

// Local types for the financial summary API response shape
interface FinancialSummaryOverview {
  totalInvoices: number;
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  profitMargin: number;
  budgetUtilization: number;
}

interface FinancialSummaryCashFlow {
  collectedRevenue: number;
  pendingRevenue: number;
  overdueInvoices: number;
  netCashFlow: number;
}

interface FinancialSummaryResponse {
  overview: FinancialSummaryOverview;
  cashFlow: FinancialSummaryCashFlow;
}

interface RevenueTrendItem {
  period: string;
  collected: number;
}

interface TrendsResponse {
  revenue?: { data?: RevenueTrendItem[] };
}

export class FinancialAnalyticsService {
  /**
   * Get financial overview
   */
  async getFinancialOverview(projectId?: string): Promise<FinancialOverview[]> {
    try {
      const summaryRaw = await analyticsApi.getFinancialSummary(
        { type: 'monthly' },
        projectId
      );
      const summary = summaryRaw as unknown as FinancialSummaryResponse;

      // Transform API response to match FinancialOverview interface
      return [{
        totalInvoices: summary.overview.totalInvoices,
        totalAmount: summary.overview.totalRevenue,
        paidAmount: summary.cashFlow.collectedRevenue,
        pendingAmount: summary.cashFlow.pendingRevenue,
        overdueCount: summary.cashFlow.overdueInvoices,
        totalRevenue: summary.overview.totalRevenue,
        totalExpenses: summary.overview.totalExpenses,
        netProfit: summary.overview.netProfit,
        profitMargin: summary.overview.profitMargin,
        cashFlow: summary.cashFlow.netCashFlow,
        budgetUtilization: summary.overview.budgetUtilization
      }];
    } catch (error) {
      log.error('Failed to get financial overview:', { data: error }, 'financialAnalytics');
      // Return empty structure with zeros instead of throwing
      return [{
        totalInvoices: 0,
        totalAmount: 0,
        paidAmount: 0,
        pendingAmount: 0,
        overdueCount: 0,
        totalRevenue: 0,
        totalExpenses: 0,
        netProfit: 0,
        profitMargin: 0,
        cashFlow: 0,
        budgetUtilization: 0
      }];
    }
  }

  /**
   * Get cash flow trends
   */
  async getCashFlowTrends(months: number = 12): Promise<CashFlowTrend[]> {
    try {
      const endDate = new Date().toISOString();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - months);

      const trendsRaw = await analyticsApi.getDashboardTrends(
        startDate.toISOString(),
        endDate,
        'month'
      );
      const trends = trendsRaw as unknown as TrendsResponse;

      // Extract revenue trends from API response
      const revenueData = trends.revenue?.data ?? [];

      return revenueData.map((item: RevenueTrendItem) => ({
        month: item.period,
        income: item.collected ?? 0,
        expenses: 0, // Not provided by current API
        netFlow: item.collected ?? 0
      }));
    } catch (error) {
      log.error('Failed to get cash flow trends:', { data: error }, 'financialAnalytics');
      // Return empty array instead of throwing
      return [];
    }
  }
}

// Export singleton instance
export const financialAnalyticsService = new FinancialAnalyticsService();