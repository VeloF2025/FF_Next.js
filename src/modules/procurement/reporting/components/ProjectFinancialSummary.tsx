/**
 * Project Financial Summary
 *
 * Combined view: FF Budget vs Committed (POs) vs Sage Actuals vs Variance.
 * Includes breakdown by account category and business unit.
 */

import { useState, useEffect } from 'react';
import {
  Loader2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  FileText,
  BarChart3,
  Download,
} from 'lucide-react';
import { useProjectFinancials } from '../hooks/useProjectFinancials';
import { formatDisplayMonthYear } from '@/utils/dateFormat';

function formatCurrency(amount: number): string {
  return `R ${amount.toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCompact(amount: number): string {
  if (Math.abs(amount) >= 1000000) return `R ${(amount / 1000000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1000) return `R ${(amount / 1000).toFixed(0)}K`;
  return `R ${amount.toFixed(0)}`;
}

function formatMonth(iso: string): string {
  return formatDisplayMonthYear(iso);
}

interface Props {
  projectId: string;
}

export function ProjectFinancialSummary({ projectId }: Props) {
  const { data, loading, error, fetchFinancials } = useProjectFinancials();
  const [activeTab, setActiveTab] = useState<'overview' | 'breakdown' | 'trend'>('overview');

  useEffect(() => {
    if (projectId) fetchFinancials(projectId);
  }, [projectId, fetchFinancials]);

  const handleExportCSV = () => {
    if (!data) return;

    const csvRows: string[] = [];
    csvRows.push('Project Financial Summary');
    csvRows.push(`Project,${data.project.name}`);
    csvRows.push('');
    csvRows.push('Summary');
    csvRows.push(`Budget,${data.summary.budget.toFixed(2)}`);
    csvRows.push(`Committed (POs),${data.summary.committed.toFixed(2)}`);
    csvRows.push(`Sage Actuals,${data.summary.sageActuals.toFixed(2)}`);
    csvRows.push(`Invoiced,${data.summary.invoiced.toFixed(2)}`);
    csvRows.push(`Outstanding,${data.summary.outstanding.toFixed(2)}`);
    csvRows.push(`Variance,${data.summary.variance.toFixed(2)}`);
    csvRows.push('');

    if (data.sageBreakdown.length > 0) {
      csvRows.push('Sage Breakdown by Category');
      csvRows.push('Category,Debit,Credit,Net Amount,Transactions');
      for (const row of data.sageBreakdown) {
        csvRows.push(
          `"${row.category}",${row.debit.toFixed(2)},${row.credit.toFixed(2)},${row.netAmount.toFixed(2)},${row.transactionCount}`
        );
      }
      csvRows.push('');
    }

    if (data.byBusinessUnit.length > 0) {
      csvRows.push('Breakdown by Business Unit');
      csvRows.push('Business Unit,Debit,Credit,Net Amount,Transactions');
      for (const row of data.byBusinessUnit) {
        csvRows.push(
          `"${row.businessUnit}",${row.debit.toFixed(2)},${row.credit.toFixed(2)},${row.netAmount.toFixed(2)},${row.transactionCount}`
        );
      }
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-financials-${data.project.name.replace(/\s+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
        <span className="ml-2 text-[var(--ff-text-secondary)]">Loading financials...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center">
        <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
        <span className="text-red-400">{error}</span>
      </div>
    );
  }

  if (!data) return null;

  const { summary, purchaseOrders, sageBreakdown, byBusinessUnit, monthlyTrend } = data;
  const variancePositive = summary.variance >= 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            {data.project.name}
          </h3>
          <span className="text-xs text-[var(--ff-text-tertiary)] uppercase">
            {data.project.status}
          </span>
        </div>
        <button
          onClick={handleExportCSV}
          className="bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-border)] text-[var(--ff-text-primary)] px-3 py-1.5 rounded-lg text-sm flex items-center"
        >
          <Download className="w-4 h-4 mr-1" />
          CSV
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard
          label="Budget"
          value={formatCompact(summary.budget)}
          icon={<DollarSign className="w-4 h-4" />}
          color="text-blue-400"
        />
        <SummaryCard
          label="Committed (POs)"
          value={formatCompact(summary.committed)}
          sub={`${purchaseOrders.total} orders`}
          icon={<FileText className="w-4 h-4" />}
          color="text-yellow-400"
        />
        <SummaryCard
          label="Sage Actuals"
          value={formatCompact(summary.sageActuals)}
          icon={<BarChart3 className="w-4 h-4" />}
          color="text-purple-400"
        />
        <SummaryCard
          label="Variance"
          value={formatCompact(summary.variance)}
          sub={`${summary.variancePercent.toFixed(1)}%`}
          icon={variancePositive
            ? <TrendingUp className="w-4 h-4" />
            : <TrendingDown className="w-4 h-4" />
          }
          color={variancePositive ? 'text-green-400' : 'text-red-400'}
        />
      </div>

      {/* PO Status Bar */}
      {purchaseOrders.total > 0 && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border)] p-4">
          <div className="text-xs text-[var(--ff-text-tertiary)] mb-2">Purchase Order Status</div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-yellow-400">{purchaseOrders.approved} Approved</span>
            <span className="text-blue-400">{purchaseOrders.sent} Sent</span>
            <span className="text-green-400">{purchaseOrders.paid} Paid</span>
            <span className="ml-auto text-[var(--ff-text-secondary)]">
              Total: {formatCurrency(purchaseOrders.totalAmount)}
            </span>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex items-center space-x-1 border-b border-[var(--ff-border)]">
        {(['overview', 'breakdown', 'trend'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm capitalize transition-colors ${
              activeTab === tab
                ? 'text-[var(--ff-accent)] border-b-2 border-[var(--ff-accent)]'
                : 'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
            }`}
          >
            {tab === 'breakdown' ? 'By Category' : tab === 'trend' ? 'Monthly Trend' : tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <OverviewTab summary={summary} byBusinessUnit={byBusinessUnit} />
      )}
      {activeTab === 'breakdown' && (
        <BreakdownTab sageBreakdown={sageBreakdown} />
      )}
      {activeTab === 'trend' && (
        <TrendTab monthlyTrend={monthlyTrend} />
      )}
    </div>
  );
}

/* ---- Sub-components ---- */

function SummaryCard({
  label, value, sub, icon, color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border)] p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[var(--ff-text-tertiary)]">{label}</span>
        <span className={color}>{icon}</span>
      </div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">{sub}</div>}
    </div>
  );
}

function OverviewTab({
  summary,
  byBusinessUnit,
}: {
  summary: { budget: number; committed: number; sageActuals: number; invoiced: number; outstanding: number };
  byBusinessUnit: Array<{ businessUnit: string; netAmount: number; transactionCount: number }>;
}) {
  const maxBU = Math.max(...byBusinessUnit.map((b) => Math.abs(b.netAmount)), 1);

  return (
    <div className="space-y-4">
      {/* Budget utilization bar */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border)] p-4">
        <div className="text-xs text-[var(--ff-text-tertiary)] mb-3">Budget Utilization</div>
        <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden flex">
          {summary.budget > 0 && (
            <>
              <div
                className="bg-purple-500 h-full"
                style={{ width: `${Math.min((summary.sageActuals / summary.budget) * 100, 100)}%` }}
                title={`Sage Actuals: ${formatCurrency(summary.sageActuals)}`}
              />
              <div
                className="bg-yellow-500/60 h-full"
                style={{
                  width: `${Math.min(
                    ((summary.committed - summary.sageActuals) / summary.budget) * 100,
                    100 - (summary.sageActuals / summary.budget) * 100
                  ).toFixed(1)}%`,
                }}
                title={`Uncommitted committed: ${formatCurrency(summary.committed - summary.sageActuals)}`}
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-[var(--ff-text-tertiary)]">
          <span className="flex items-center">
            <span className="w-2 h-2 rounded-full bg-purple-500 mr-1" />
            Actuals
          </span>
          <span className="flex items-center">
            <span className="w-2 h-2 rounded-full bg-yellow-500/60 mr-1" />
            Committed (unspent)
          </span>
          <span className="ml-auto">
            {summary.budget > 0
              ? `${((summary.sageActuals / summary.budget) * 100).toFixed(1)}% utilized`
              : 'No budget set'}
          </span>
        </div>
      </div>

      {/* BU breakdown */}
      {byBusinessUnit.length > 0 && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border)] p-4">
          <div className="text-xs text-[var(--ff-text-tertiary)] mb-3">Spend by Business Unit</div>
          <div className="space-y-2">
            {byBusinessUnit.map((bu) => (
              <div key={bu.businessUnit} className="flex items-center gap-3">
                <span className="text-sm text-[var(--ff-text-secondary)] w-28 truncate">
                  {bu.businessUnit}
                </span>
                <div className="flex-1 h-5 bg-[var(--ff-bg-tertiary)] rounded overflow-hidden">
                  <div
                    className="h-full bg-[var(--ff-accent)]/40 rounded"
                    style={{ width: `${(Math.abs(bu.netAmount) / maxBU) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-[var(--ff-text-primary)] w-24 text-right">
                  {formatCompact(bu.netAmount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BreakdownTab({
  sageBreakdown,
}: {
  sageBreakdown: Array<{
    category: string;
    debit: number;
    credit: number;
    netAmount: number;
    transactionCount: number;
  }>;
}) {
  if (sageBreakdown.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--ff-text-tertiary)]">
        No Sage transaction data for this project.
      </div>
    );
  }

  const total = sageBreakdown.reduce((s, r) => s + r.netAmount, 0);

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border)] overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--ff-border)]">
            <th className="text-left p-3 text-[var(--ff-text-tertiary)] font-medium">Category</th>
            <th className="text-right p-3 text-[var(--ff-text-tertiary)] font-medium">Debit</th>
            <th className="text-right p-3 text-[var(--ff-text-tertiary)] font-medium">Credit</th>
            <th className="text-right p-3 text-[var(--ff-text-tertiary)] font-medium">Net</th>
            <th className="text-right p-3 text-[var(--ff-text-tertiary)] font-medium">Txns</th>
          </tr>
        </thead>
        <tbody>
          {sageBreakdown.map((row) => (
            <tr key={row.category} className="hover:bg-[var(--ff-bg-tertiary)]">
              <td className="p-3 text-[var(--ff-text-secondary)]">{row.category || 'Uncategorized'}</td>
              <td className="p-3 text-right text-[var(--ff-text-secondary)]">{formatCurrency(row.debit)}</td>
              <td className="p-3 text-right text-[var(--ff-text-secondary)]">{formatCurrency(row.credit)}</td>
              <td className={`p-3 text-right font-medium ${row.netAmount >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                {formatCurrency(row.netAmount)}
              </td>
              <td className="p-3 text-right text-[var(--ff-text-tertiary)]">{row.transactionCount}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-[var(--ff-accent)] bg-[var(--ff-bg-tertiary)]">
            <td className="p-3 font-bold text-[var(--ff-text-primary)]">Total</td>
            <td className="p-3 text-right font-bold text-[var(--ff-text-primary)]">
              {formatCurrency(sageBreakdown.reduce((s, r) => s + r.debit, 0))}
            </td>
            <td className="p-3 text-right font-bold text-[var(--ff-text-primary)]">
              {formatCurrency(sageBreakdown.reduce((s, r) => s + r.credit, 0))}
            </td>
            <td className={`p-3 text-right font-bold ${total >= 0 ? 'text-red-400' : 'text-green-400'}`}>
              {formatCurrency(total)}
            </td>
            <td className="p-3 text-right font-bold text-[var(--ff-text-primary)]">
              {sageBreakdown.reduce((s, r) => s + r.transactionCount, 0)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function TrendTab({
  monthlyTrend,
}: {
  monthlyTrend: Array<{ month: string; debit: number; credit: number; netAmount: number }>;
}) {
  if (monthlyTrend.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--ff-text-tertiary)]">
        No monthly trend data available.
      </div>
    );
  }

  const maxAmount = Math.max(...monthlyTrend.map((m) => Math.max(m.debit, m.credit)), 1);

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border)] p-4">
      <div className="space-y-3">
        {monthlyTrend.map((month) => (
          <div key={month.month} className="flex items-center gap-3">
            <span className="text-sm text-[var(--ff-text-secondary)] w-20">{formatMonth(month.month)}</span>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--ff-text-tertiary)] w-8">Dr</span>
                <div className="flex-1 h-3 bg-[var(--ff-bg-tertiary)] rounded overflow-hidden">
                  <div
                    className="h-full bg-red-400/50 rounded"
                    style={{ width: `${(month.debit / maxAmount) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-[var(--ff-text-secondary)] w-20 text-right">
                  {formatCompact(month.debit)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--ff-text-tertiary)] w-8">Cr</span>
                <div className="flex-1 h-3 bg-[var(--ff-bg-tertiary)] rounded overflow-hidden">
                  <div
                    className="h-full bg-green-400/50 rounded"
                    style={{ width: `${(month.credit / maxAmount) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-[var(--ff-text-secondary)] w-20 text-right">
                  {formatCompact(month.credit)}
                </span>
              </div>
            </div>
            <span className={`text-sm font-medium w-20 text-right ${month.netAmount >= 0 ? 'text-red-400' : 'text-green-400'}`}>
              {formatCompact(month.netAmount)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-[var(--ff-border)] text-xs text-[var(--ff-text-tertiary)]">
        <span className="flex items-center">
          <span className="w-2 h-2 rounded-full bg-red-400/50 mr-1" />
          Debits
        </span>
        <span className="flex items-center">
          <span className="w-2 h-2 rounded-full bg-green-400/50 mr-1" />
          Credits
        </span>
        <span className="ml-auto font-medium text-[var(--ff-text-primary)]">
          Total Net: {formatCurrency(monthlyTrend.reduce((s, m) => s + m.netAmount, 0))}
        </span>
      </div>
    </div>
  );
}
