/**
 * Finance Dashboard Tab
 * Main finance overview showing Client POs, budget, procurement, and income summaries
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { FinanceDashboardData } from '@/types/finance';
import { FinanceSummaryCards } from './FinanceSummaryCards';
import { ClientPOProgressCard } from './ClientPOProgressCard';
import { BudgetHealthWidget } from './BudgetHealthWidget';
import { RecentTransactionsTable } from './RecentTransactionsTable';
import { log } from '@/lib/logger';

interface FinanceDashboardTabProps {
  projectId: string;
  onNavigateToIncome?: () => void;
  onNavigateToBudget?: () => void;
}

export function FinanceDashboardTab({
  projectId,
  onNavigateToIncome,
  onNavigateToBudget,
}: FinanceDashboardTabProps) {
  const router = useRouter();
  const [data, setData] = useState<FinanceDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        setLoading(true);
        const response = await fetch(`/api/projects/${projectId}/finance/dashboard`);
        if (!response.ok) {
          throw new Error('Failed to fetch finance dashboard');
        }
        const result = await response.json();
        setData(result.data);
      } catch (err) {
        log.error('Failed to fetch finance dashboard', { projectId, err });
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    }

    fetchDashboard();
  }, [projectId]);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-[var(--ff-bg-secondary)] rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64 bg-[var(--ff-bg-secondary)] rounded-lg" />
          <div className="h-64 bg-[var(--ff-bg-secondary)] rounded-lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-6 text-center">
        <div className="text-red-400 mb-2">Failed to load finance dashboard</div>
        <div className="text-sm text-[var(--ff-text-secondary)]">{error}</div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const handleNavigateToIncome = () => {
    if (onNavigateToIncome) {
      onNavigateToIncome();
    }
  };

  const handleNavigateToBudget = () => {
    if (onNavigateToBudget) {
      onNavigateToBudget();
    } else {
      router.push(`/projects/${projectId}/budget`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <FinanceSummaryCards data={data} />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Client PO Progress */}
        <ClientPOProgressCard
          clientPOs={data.clientPOs}
          onViewDetails={handleNavigateToIncome}
        />

        {/* Budget Health */}
        <BudgetHealthWidget
          budget={data.budget}
          onViewBudget={handleNavigateToBudget}
        />
      </div>

      {/* Net Position Summary */}
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Net Position</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-[var(--ff-bg-secondary)] rounded-lg">
            <div className="text-2xl font-bold text-green-400">
              R {data.netPosition.totalIncome.toLocaleString()}
            </div>
            <div className="text-sm text-[var(--ff-text-secondary)]">Total Income</div>
          </div>
          <div className="text-center p-4 bg-[var(--ff-bg-secondary)] rounded-lg">
            <div className="text-2xl font-bold text-red-400">
              R {data.netPosition.totalExpenses.toLocaleString()}
            </div>
            <div className="text-sm text-[var(--ff-text-secondary)]">Total Expenses</div>
          </div>
          <div className="text-center p-4 bg-[var(--ff-bg-secondary)] rounded-lg">
            <div className={`text-2xl font-bold ${data.netPosition.margin >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              R {data.netPosition.margin.toLocaleString()}
            </div>
            <div className="text-sm text-[var(--ff-text-secondary)]">Net Margin</div>
          </div>
          <div className="text-center p-4 bg-[var(--ff-bg-secondary)] rounded-lg">
            <div className={`text-2xl font-bold ${data.netPosition.marginPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {data.netPosition.marginPercent}%
            </div>
            <div className="text-sm text-[var(--ff-text-secondary)]">Margin %</div>
          </div>
        </div>
      </div>

      {/* This Week Activity */}
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">This Week</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-4 p-4 bg-[var(--ff-bg-secondary)] rounded-lg">
            <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{data.thisWeek.activations}</div>
              <div className="text-sm text-[var(--ff-text-secondary)]">Activations</div>
            </div>
          </div>
          <div className="flex items-center gap-4 p-4 bg-[var(--ff-bg-secondary)] rounded-lg">
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{data.thisWeek.invoicesGenerated}</div>
              <div className="text-sm text-[var(--ff-text-secondary)]">Invoices Generated</div>
            </div>
          </div>
          <div className="flex items-center gap-4 p-4 bg-[var(--ff-bg-secondary)] rounded-lg">
            <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                R {data.thisWeek.paymentsReceived.toLocaleString()}
              </div>
              <div className="text-sm text-[var(--ff-text-secondary)]">Payments Received</div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <RecentTransactionsTable transactions={data.recentTransactions} />
    </div>
  );
}
