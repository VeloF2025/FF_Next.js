/**
 * Finance Summary Cards
 * 4 KPI cards showing key financial metrics
 */

import type { FinanceDashboardData } from '@/types/finance';

interface FinanceSummaryCardsProps {
  data: FinanceDashboardData;
}

export function FinanceSummaryCards({ data }: FinanceSummaryCardsProps) {
  const cards = [
    {
      title: 'Contract Value',
      value: `R ${data.clientPOs.totalContractValue.toLocaleString()}`,
      subtitle: `${data.clientPOs.activePoCount} active PO${data.clientPOs.activePoCount !== 1 ? 's' : ''}`,
      color: 'blue',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      title: 'Invoiced',
      value: `R ${data.clientPOs.totalInvoiced.toLocaleString()}`,
      subtitle: `${data.clientPOs.invoicingProgress}% of contract`,
      color: 'green',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
    },
    {
      title: 'Outstanding',
      value: `R ${data.clientPOs.totalOutstanding.toLocaleString()}`,
      subtitle: `${data.invoices.sentCount} invoice${data.invoices.sentCount !== 1 ? 's' : ''} pending`,
      color: 'amber',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: 'Budget Available',
      value: data.budget ? `R ${data.budget.availableBudget.toLocaleString()}` : 'Not Set',
      subtitle: data.budget ? `${data.budget.utilizationPercent}% utilized` : 'Configure budget',
      color: data.budget?.health === 'critical' ? 'red' : data.budget?.health === 'warning' ? 'amber' : 'purple',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ];

  const colorClasses: Record<string, { bg: string; icon: string; text: string }> = {
    blue: {
      bg: 'bg-blue-500/10',
      icon: 'text-blue-400 bg-blue-500/20',
      text: 'text-blue-400',
    },
    green: {
      bg: 'bg-green-500/10',
      icon: 'text-green-400 bg-green-500/20',
      text: 'text-green-400',
    },
    amber: {
      bg: 'bg-amber-500/10',
      icon: 'text-amber-400 bg-amber-500/20',
      text: 'text-amber-400',
    },
    purple: {
      bg: 'bg-purple-500/10',
      icon: 'text-purple-400 bg-purple-500/20',
      text: 'text-purple-400',
    },
    red: {
      bg: 'bg-red-500/10',
      icon: 'text-red-400 bg-red-500/20',
      text: 'text-red-400',
    },
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, index) => {
        const colors = colorClasses[card.color] ?? { bg: 'bg-blue-500/10', icon: 'text-blue-400 bg-blue-500/20', text: 'text-blue-400' };
        return (
          <div
            key={index}
            className={`rounded-lg border border-[var(--ff-border-light)] p-4 ${colors.bg}`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors.icon}`}>
                {card.icon}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-[var(--ff-text-secondary)]">{card.title}</div>
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{card.value}</div>
              <div className={`text-sm ${colors.text}`}>{card.subtitle}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
