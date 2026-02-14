/**
 * Client PO Progress Card
 * Shows progress of Client Purchase Orders: drops contracted, activated, invoiced
 */

import type { ClientPOSummary } from '@/types/finance';

interface ClientPOProgressCardProps {
  clientPOs: ClientPOSummary;
  onViewDetails?: () => void;
}

export function ClientPOProgressCard({ clientPOs, onViewDetails }: ClientPOProgressCardProps) {
  const progressBars = [
    {
      label: 'Drops Activated',
      current: clientPOs.totalDropsActivated,
      total: clientPOs.totalDropsContracted,
      percent: clientPOs.activationProgress,
      color: 'bg-blue-500',
    },
    {
      label: 'Amount Invoiced',
      current: clientPOs.totalInvoiced,
      total: clientPOs.totalContractValue,
      percent: clientPOs.invoicingProgress,
      color: 'bg-green-500',
      isCurrency: true,
    },
    {
      label: 'Amount Collected',
      current: clientPOs.totalPaid,
      total: clientPOs.totalInvoiced || 1, // Avoid division by zero
      percent: clientPOs.totalInvoiced > 0
        ? Math.round((clientPOs.totalPaid / clientPOs.totalInvoiced) * 100 * 100) / 100
        : 0,
      color: 'bg-purple-500',
      isCurrency: true,
    },
  ];

  return (
    <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Client PO Progress</h3>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {clientPOs.activePoCount} active PO{clientPOs.activePoCount !== 1 ? 's' : ''} of {clientPOs.poCount} total
          </p>
          {clientPOs.totalSpares > 0 && (
            <p className="text-xs text-amber-400 mt-0.5">
              {clientPOs.totalDropsContracted.toLocaleString()} PO + {clientPOs.totalSpares.toLocaleString()} spares = {clientPOs.totalProjectDrops.toLocaleString()} total
            </p>
          )}
        </div>
        {onViewDetails && (
          <button
            onClick={onViewDetails}
            className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            View Details
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {clientPOs.poCount === 0 ? (
        <div className="text-center py-8 text-[var(--ff-text-secondary)]">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p>No Client POs yet</p>
          <p className="text-sm mt-1">Create a Client PO to start tracking income</p>
        </div>
      ) : (
        <div className="space-y-5">
          {progressBars.map((bar, index) => (
            <div key={index}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-[var(--ff-text-secondary)]">{bar.label}</span>
                <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                  {bar.isCurrency ? (
                    <>R {bar.current.toLocaleString()} / R {bar.total.toLocaleString()}</>
                  ) : (
                    <>{bar.current.toLocaleString()} / {bar.total.toLocaleString()}</>
                  )}
                </span>
              </div>
              <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                <div
                  className={`h-full ${bar.color} transition-all duration-300`}
                  style={{ width: `${Math.min(bar.percent, 100)}%` }}
                />
              </div>
              <div className="text-right mt-1">
                <span className="text-xs text-[var(--ff-text-secondary)]">{bar.percent}%</span>
              </div>
              {/* Spare info below Drops Activated bar */}
              {index === 0 && clientPOs.totalSpares > 0 && (
                <div className="mt-2 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-400 flex items-center gap-2">
                  <span>{clientPOs.totalSpares.toLocaleString()} spares</span>
                  <span className="text-amber-500/40">|</span>
                  <span>{clientPOs.sparesUsed.toLocaleString()} used</span>
                  <span className="text-amber-500/40">|</span>
                  <span>{clientPOs.sparesAvailable.toLocaleString()} available</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Outstanding Summary */}
      {clientPOs.totalOutstanding > 0 && (
        <div className="mt-6 pt-4 border-t border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--ff-text-secondary)]">Outstanding Amount</span>
            <span className="text-lg font-bold text-amber-400">
              R {clientPOs.totalOutstanding.toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
