/**
 * Client PO List Component
 * Displays a list of Client Purchase Orders with progress indicators
 */

import { useState } from 'react';
import type { ClientPurchaseOrder } from '@/types/finance';
import { ClientPODetailModal } from './ClientPODetailModal';

interface ClientPOListProps {
  projectId: string;
  clientPOs: ClientPurchaseOrder[];
  onRefresh: () => void;
}

export function ClientPOList({ projectId, clientPOs, onRefresh }: ClientPOListProps) {
  const [selectedPO, setSelectedPO] = useState<ClientPurchaseOrder | null>(null);

  if (clientPOs.length === 0) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-500/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">No Client POs Yet</h3>
        <p className="text-[var(--ff-text-secondary)] max-w-md mx-auto">
          Create a Client Purchase Order to track contracted drops and generate customer invoices.
        </p>
      </div>
    );
  }

  const statusColors: Record<string, { bg: string; text: string }> = {
    draft: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
    active: { bg: 'bg-green-500/20', text: 'text-green-400' },
    completed: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
    cancelled: { bg: 'bg-red-500/20', text: 'text-red-400' },
  };

  return (
    <>
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)]">
              <th className="px-4 py-3 font-medium">PO Number</th>
              <th className="px-4 py-3 font-medium">Contracted</th>
              <th className="px-4 py-3 font-medium">Progress</th>
              <th className="px-4 py-3 font-medium text-right">Value</th>
              <th className="px-4 py-3 font-medium text-right">Invoiced</th>
              <th className="px-4 py-3 font-medium text-center">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ff-border-light)]">
            {clientPOs.map((po) => {
              const activationPercent = po.contractedDrops > 0
                ? Math.round((po.dropsActivated / po.contractedDrops) * 100)
                : 0;
              const invoicedPercent = po.totalValue > 0
                ? Math.round((po.amountInvoiced / po.totalValue) * 100)
                : 0;
              const colors = statusColors[po.status] ?? { bg: 'bg-gray-500/20', text: 'text-gray-400' };

              return (
                <tr key={po.id} className="hover:bg-[var(--ff-bg-secondary)] transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <div className="font-medium text-[var(--ff-text-primary)]">{po.poNumber}</div>
                      {po.reference && (
                        <div className="text-xs text-[var(--ff-text-secondary)]">{po.reference}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-[var(--ff-text-primary)]">
                      {po.contractedDrops.toLocaleString()} drops
                    </div>
                    <div className="text-xs text-[var(--ff-text-secondary)]">
                      @ R{po.pricePerDrop.toLocaleString()} each
                    </div>
                    {po.sparesAllocated > 0 && (
                      <div className="text-xs text-amber-400 mt-0.5">
                        + {po.sparesAllocated.toLocaleString()} spares ({po.sparesUsed} used)
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-32">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[var(--ff-text-secondary)]">Activated</span>
                        <span className="text-[var(--ff-text-primary)]">{activationPercent}%</span>
                      </div>
                      <div className="h-1.5 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all"
                          style={{ width: `${Math.min(activationPercent, 100)}%` }}
                        />
                      </div>
                      <div className="text-xs text-[var(--ff-text-secondary)] mt-1">
                        {po.dropsActivated} / {po.contractedDrops}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="text-sm font-medium text-[var(--ff-text-primary)]">
                      R {po.totalValue.toLocaleString()}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="text-sm text-[var(--ff-text-primary)]">
                      R {po.amountInvoiced.toLocaleString()}
                    </div>
                    <div className="text-xs text-green-400">
                      {invoicedPercent}%
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.text} capitalize`}>
                      {po.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelectedPO(po)}
                      className="text-blue-400 hover:text-blue-300 text-sm"
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedPO && (
        <ClientPODetailModal
          projectId={projectId}
          clientPO={selectedPO}
          onClose={() => setSelectedPO(null)}
          onUpdated={() => {
            setSelectedPO(null);
            onRefresh();
          }}
        />
      )}
    </>
  );
}
