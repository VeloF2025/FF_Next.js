/**
 * Project Budget Page
 * PRD-057: Project Budget Tracking System
 *
 * Main budget management page for a project - displays budget overview,
 * category breakdown, alerts, and transaction history
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import {
  BudgetOverviewCard,
  CategoryBreakdownTable,
  BudgetAlertsPanel,
  BudgetAdjustmentModal,
} from '@/components/budget';
import { ArrowLeft, Plus, RefreshCw, History, AlertCircle } from 'lucide-react';
import type {
  ProjectBudget,
  BudgetCategory,
  BudgetAlert,
  BudgetTransaction,
  BudgetHealth,
  BudgetStatus,
} from '@/types/budget';

interface BudgetPageData {
  budget: ProjectBudget | null;
  categories: BudgetCategory[];
  alerts: BudgetAlert[];
  transactions: BudgetTransaction[];
  project: {
    id: string;
    name: string;
    projectNumber: string;
  } | null;
}

export default function ProjectBudgetPage() {
  const router = useRouter();
  const { id: projectId } = router.query;

  const [data, setData] = useState<BudgetPageData>({
    budget: null,
    categories: [],
    alerts: [],
    transactions: [],
    project: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions'>('overview');

  // Fetch budget data
  const fetchBudgetData = useCallback(async () => {
    if (!projectId || typeof projectId !== 'string') return;

    setLoading(true);
    setError(null);

    try {
      // Fetch budget, categories, and alerts in parallel
      const [budgetRes, categoriesRes, alertsRes, transactionsRes, projectRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/budget`),
        fetch(`/api/projects/${projectId}/budget/categories`),
        fetch(`/api/projects/${projectId}/budget/alerts`),
        fetch(`/api/projects/${projectId}/budget/transactions?limit=10`),
        fetch(`/api/projects/${projectId}`),
      ]);

      const budgetData = await budgetRes.json();
      const categoriesData = await categoriesRes.json();
      const alertsData = await alertsRes.json();
      const transactionsData = await transactionsRes.json();
      const projectData = await projectRes.json();

      // Budget API returns { exists: false } or { exists: true, budget, categories, summary }
      const budgetExists = budgetRes.ok && budgetData.data?.exists === true;

      setData({
        budget: budgetExists ? budgetData.data.budget : null,
        categories: budgetExists
          ? (budgetData.data.categories || [])
          : (categoriesRes.ok && Array.isArray(categoriesData.data) ? categoriesData.data : []),
        alerts: alertsRes.ok && Array.isArray(alertsData.data) ? alertsData.data : [],
        transactions: transactionsRes.ok && Array.isArray(transactionsData.data) ? transactionsData.data : [],
        project: projectRes.ok ? projectData.data : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load budget data');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchBudgetData();
  }, [fetchBudgetData]);

  // Handle budget adjustment
  const handleAdjustment = async (adjustmentData: {
    adjustmentType: 'increase' | 'decrease' | 'reallocation';
    amount: number;
    reason: string;
  }) => {
    if (!projectId) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/budget/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adjustmentData),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error?.message || 'Failed to adjust budget');
      }

      // Refresh data
      await fetchBudgetData();
      setAdjustModalOpen(false);
    } catch (err) {
      throw err;
    } finally {
      setActionLoading(false);
    }
  };

  // Handle BOQ sync
  const handleSyncBoq = async () => {
    if (!projectId) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/budget/sync-boq`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error?.message || 'Failed to sync BOQ');
      }

      await fetchBudgetData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync BOQ');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle alert acknowledge
  const handleAcknowledge = async (alertId: string) => {
    if (!projectId) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/budget/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'acknowledge' }),
      });

      if (!res.ok) {
        throw new Error('Failed to acknowledge alert');
      }

      await fetchBudgetData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to acknowledge alert');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle alert resolve
  const handleResolve = async (alertId: string) => {
    if (!projectId) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/budget/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve' }),
      });

      if (!res.ok) {
        throw new Error('Failed to resolve alert');
      }

      await fetchBudgetData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve alert');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle create budget
  const handleCreateBudget = async (budgetData: {
    sourceType: 'manual' | 'boq';
    totalBudget?: number;
    boqId?: string;
  }) => {
    if (!projectId) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/budget`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(budgetData),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error?.message || 'Failed to create budget');
      }

      await fetchBudgetData();
      setCreateModalOpen(false);
    } catch (err) {
      throw err;
    } finally {
      setActionLoading(false);
    }
  };

  // Calculate budget health from utilization
  const getBudgetHealth = (budget: ProjectBudget | null): BudgetHealth => {
    if (!budget) return 'healthy';
    const utilization = budget.totalBudget > 0
      ? (budget.committedAmount / budget.totalBudget) * 100
      : 0;
    if (utilization >= 100) return 'critical';
    if (utilization >= 80) return 'warning';
    return 'healthy';
  };

  // Format transaction for display
  const formatTransaction = (tx: BudgetTransaction) => {
    const typeLabels: Record<string, string> = {
      allocation: 'Allocation',
      adjustment: 'Adjustment',
      commitment: 'Commitment',
      commitment_reversal: 'Reversal',
      receipt: 'Receipt',
    };
    return {
      ...tx,
      typeLabel: typeLabels[tx.transactionType] || tx.transactionType,
    };
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
            <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
            <div className="h-48 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </div>
        </div>
      </AppLayout>
    );
  }

  const noBudget = !data.budget;
  const budget = data.budget;
  const utilizationPercent = budget && budget.totalBudget > 0
    ? (budget.committedAmount / budget.totalBudget) * 100
    : 0;

  return (
    <AppLayout>
      <div className="p-6 space-y-6" data-testid="budget-page">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push(`/projects/${projectId}`)}
              className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Project Budget</h1>
              {data.project && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {data.project.projectNumber} - {data.project.name}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchBudgetData}
              disabled={actionLoading}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${actionLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {noBudget && (
              <button
                onClick={() => setCreateModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                data-testid="create-budget-btn"
              >
                <Plus className="h-4 w-4" />
                Create Budget
              </button>
            )}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-500 hover:text-red-700 dark:hover:text-red-400"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* No Budget State */}
        {noBudget && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
            <div className="mx-auto w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mb-4">
              <Plus className="h-6 w-6 text-gray-400 dark:text-gray-500" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Budget Set</h2>
            <p className="text-gray-500 dark:text-gray-400 mb-4 max-w-md mx-auto">
              This project doesn&apos;t have a budget configured yet. Create a budget to track
              spending and enforce limits on purchase orders.
            </p>
            <button
              onClick={() => setCreateModalOpen(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              Create Budget
            </button>
          </div>
        )}

        {/* Budget Content */}
        {budget && (
          <>
            {/* Tab Navigation */}
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                  activeTab === 'overview'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setActiveTab('transactions')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${
                  activeTab === 'transactions'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <History className="h-4 w-4" />
                Transactions
              </button>
            </div>

            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column - Overview & Categories */}
                <div className="lg:col-span-2 space-y-6">
                  <BudgetOverviewCard
                    totalBudget={budget.totalBudget}
                    committedAmount={budget.committedAmount}
                    actualAmount={budget.actualAmount}
                    availableBudget={budget.availableBudget}
                    utilizationPercent={utilizationPercent}
                    health={getBudgetHealth(budget)}
                    status={budget.status as BudgetStatus}
                    currency={budget.currency}
                    sourceType={budget.sourceType}
                    onSyncBoq={budget.sourceType !== 'manual' ? handleSyncBoq : undefined}
                    onAdjust={() => setAdjustModalOpen(true)}
                    canAdjust={true}
                  />

                  <CategoryBreakdownTable
                    categories={data.categories}
                    currency={budget.currency}
                    canEdit={true}
                  />
                </div>

                {/* Right Column - Alerts */}
                <div className="space-y-6">
                  <BudgetAlertsPanel
                    alerts={data.alerts}
                    onAcknowledge={handleAcknowledge}
                    onResolve={handleResolve}
                    loading={actionLoading}
                  />
                </div>
              </div>
            )}

            {activeTab === 'transactions' && (
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                <div className="p-4 border-b border-gray-100 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Transaction History</h3>
                </div>
                {data.transactions.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                    <History className="h-8 w-8 mx-auto mb-2 text-gray-400 dark:text-gray-500" />
                    <p>No transactions yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                          <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-gray-300">Date</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-gray-300">Type</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-gray-300">Description</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-gray-300">Reference</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-600 dark:text-gray-300">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.transactions.map((tx) => {
                          const formatted = formatTransaction(tx);
                          const isDebit = ['commitment', 'receipt'].includes(tx.transactionType);
                          return (
                            <tr key={tx.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                              <td className="py-3 px-4 text-gray-700 dark:text-gray-300">
                                {new Date(tx.createdAt).toLocaleDateString('en-ZA')}
                              </td>
                              <td className="py-3 px-4">
                                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                  tx.transactionType === 'commitment' ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400' :
                                  tx.transactionType === 'receipt' ? 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400' :
                                  tx.transactionType === 'adjustment' ? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400' :
                                  tx.transactionType === 'commitment_reversal' ? 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400' :
                                  'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                                }`}>
                                  {formatted.typeLabel}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-gray-700 dark:text-gray-300">{tx.description || '-'}</td>
                              <td className="py-3 px-4 text-gray-500 dark:text-gray-400">{tx.sourceNumber || '-'}</td>
                              <td className={`py-3 px-4 text-right font-medium ${
                                isDebit ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                              }`}>
                                {isDebit ? '-' : '+'}
                                {new Intl.NumberFormat('en-ZA', {
                                  style: 'currency',
                                  currency: budget.currency || 'ZAR',
                                  minimumFractionDigits: 0,
                                }).format(Math.abs(tx.amount))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Budget Adjustment Modal */}
        <BudgetAdjustmentModal
          open={adjustModalOpen}
          onClose={() => setAdjustModalOpen(false)}
          onSubmit={handleAdjustment}
          currentBudget={budget?.totalBudget || 0}
          currency={budget?.currency}
        />

        {/* Budget Create Modal */}
        {createModalOpen && (
          <BudgetCreateModal
            open={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            onSubmit={handleCreateBudget}
            projectId={projectId as string}
          />
        )}
      </div>
    </AppLayout>
  );
}

// Budget Create Modal Component
interface BudgetCreateModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { sourceType: 'manual' | 'boq'; totalBudget?: number; boqId?: string }) => Promise<void>;
  projectId: string;
}

function BudgetCreateModal({ open, onClose, onSubmit, projectId }: BudgetCreateModalProps) {
  const [sourceType, setSourceType] = useState<'manual' | 'boq'>('manual');
  const [totalBudget, setTotalBudget] = useState('');
  const [boqId, setBoqId] = useState('');
  const [boqs, setBoqs] = useState<Array<{ id: string; name: string; total: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available BOQs
  useEffect(() => {
    if (open && sourceType === 'boq') {
      fetch(`/api/projects/${projectId}/boq`)
        .then((res) => res.json())
        .then((data) => {
          if (data.data) setBoqs(data.data);
        })
        .catch(() => setBoqs([]));
    }
  }, [open, sourceType, projectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (sourceType === 'manual') {
      const amount = parseFloat(totalBudget);
      if (isNaN(amount) || amount <= 0) {
        setError('Please enter a valid budget amount');
        return;
      }
    } else if (!boqId) {
      setError('Please select a BOQ');
      return;
    }

    setLoading(true);
    try {
      await onSubmit({
        sourceType,
        totalBudget: sourceType === 'manual' ? parseFloat(totalBudget) : undefined,
        boqId: sourceType === 'boq' ? boqId : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create budget');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4" role="dialog" aria-modal="true">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Create Project Budget</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Set up budget tracking for this project</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-4 space-y-4">
            {/* Source Type */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Budget Source</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="sourceType"
                    value="manual"
                    checked={sourceType === 'manual'}
                    onChange={() => setSourceType('manual')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Manual Entry</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="sourceType"
                    value="boq"
                    checked={sourceType === 'boq'}
                    onChange={() => setSourceType('boq')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Sync from BOQ</span>
                </label>
              </div>
            </div>

            {/* Manual Budget Input */}
            {sourceType === 'manual' && (
              <div className="space-y-2">
                <label htmlFor="totalBudget" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Total Budget (ZAR)
                </label>
                <input
                  id="totalBudget"
                  type="number"
                  min="0"
                  step="0.01"
                  value={totalBudget}
                  onChange={(e) => setTotalBudget(e.target.value)}
                  placeholder="Enter budget amount"
                  required
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            )}

            {/* BOQ Selection */}
            {sourceType === 'boq' && (
              <div className="space-y-2">
                <label htmlFor="boqSelect" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Select BOQ
                </label>
                <select
                  id="boqSelect"
                  value={boqId}
                  onChange={(e) => setBoqId(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select a BOQ...</option>
                  {boqs.map((boq) => (
                    <option key={boq.id} value={boq.id}>
                      {boq.name} - R{boq.total.toLocaleString()}
                    </option>
                  ))}
                </select>
                {boqs.length === 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">No approved BOQs available for this project</p>
                )}
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 rounded-b-lg">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Budget'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
