/**
 * Project Income Tab
 * Manages Client POs and Customer Invoices
 */

import { useState, useEffect, useCallback } from 'react';
import type { ClientPurchaseOrder, CustomerInvoice, ClientPOSummary, CustomerInvoiceSummary } from '@/types/finance';
import { ClientPOList } from '@/modules/projects/components/finance/ClientPOList';
import { CustomerInvoiceList } from '@/modules/projects/components/finance/CustomerInvoiceList';
import { ClientPOCreateModal } from '@/modules/projects/components/finance/ClientPOCreateModal';
import { InvoiceGenerationModal } from '@/modules/projects/components/finance/InvoiceGenerationModal';
import { log } from '@/lib/logger';

interface ProjectIncomeTabProps {
  projectId: string;
}

type IncomeSubTab = 'client-pos' | 'invoices';

export function ProjectIncomeTab({ projectId }: ProjectIncomeTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<IncomeSubTab>('client-pos');
  const [clientPOs, setClientPOs] = useState<ClientPurchaseOrder[]>([]);
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [poSummary, setPoSummary] = useState<ClientPOSummary | null>(null);
  const [invoiceSummary, setInvoiceSummary] = useState<CustomerInvoiceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreatePO, setShowCreatePO] = useState(false);
  const [showGenerateInvoice, setShowGenerateInvoice] = useState(false);

  const fetchClientPOs = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/client-pos`);
      if (!response.ok) throw new Error('Failed to fetch Client POs');
      const result = await response.json();
      setClientPOs(result.data?.clientPOs || []);
    } catch (error) {
      log.error('Failed to fetch Client POs', { projectId, error });
    }
  }, [projectId]);

  const fetchInvoices = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/customer-invoices`);
      if (!response.ok) throw new Error('Failed to fetch invoices');
      const result = await response.json();
      setInvoices(result.data?.invoices || []);
      setInvoiceSummary(result.data?.summary || null);
    } catch (error) {
      log.error('Failed to fetch invoices', { projectId, error });
    }
  }, [projectId]);

  const fetchSummary = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/finance/dashboard`);
      if (!response.ok) throw new Error('Failed to fetch summary');
      const result = await response.json();
      setPoSummary(result.data?.clientPOs || null);
    } catch (error) {
      log.error('Failed to fetch summary', { projectId, error });
    }
  }, [projectId]);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      await Promise.all([fetchClientPOs(), fetchInvoices(), fetchSummary()]);
      setLoading(false);
    }
    loadData();
  }, [fetchClientPOs, fetchInvoices, fetchSummary]);

  const handlePOCreated = useCallback(async () => {
    setShowCreatePO(false);
    await Promise.all([fetchClientPOs(), fetchSummary()]);
  }, [fetchClientPOs, fetchSummary]);

  const handleInvoiceGenerated = useCallback(async () => {
    setShowGenerateInvoice(false);
    await Promise.all([fetchInvoices(), fetchSummary()]);
  }, [fetchInvoices, fetchSummary]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-12 bg-[var(--ff-bg-secondary)] rounded-lg" />
        <div className="h-64 bg-[var(--ff-bg-secondary)] rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      {poSummary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <div className="text-sm text-[var(--ff-text-secondary)]">Contract Value</div>
            <div className="text-xl font-bold text-[var(--ff-text-primary)]">
              R {poSummary.totalContractValue.toLocaleString()}
            </div>
            <div className="text-xs text-blue-400">{poSummary.activePoCount} active POs</div>
          </div>
          <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <div className="text-sm text-[var(--ff-text-secondary)]">Activations</div>
            <div className="text-xl font-bold text-[var(--ff-text-primary)]">
              {poSummary.totalDropsActivated} / {poSummary.totalDropsContracted}
            </div>
            <div className="text-xs text-green-400">{poSummary.activationProgress}% complete</div>
          </div>
          <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <div className="text-sm text-[var(--ff-text-secondary)]">Invoiced</div>
            <div className="text-xl font-bold text-[var(--ff-text-primary)]">
              R {poSummary.totalInvoiced.toLocaleString()}
            </div>
            <div className="text-xs text-purple-400">{poSummary.invoicingProgress}% of contract</div>
          </div>
          <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <div className="text-sm text-[var(--ff-text-secondary)]">Outstanding</div>
            <div className="text-xl font-bold text-amber-400">
              R {poSummary.totalOutstanding.toLocaleString()}
            </div>
            <div className="text-xs text-[var(--ff-text-secondary)]">Awaiting payment</div>
          </div>
        </div>
      )}

      {/* Sub-tabs and Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveSubTab('client-pos')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeSubTab === 'client-pos'
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-secondary)]'
            }`}
          >
            Client POs ({clientPOs.length})
          </button>
          <button
            onClick={() => setActiveSubTab('invoices')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeSubTab === 'invoices'
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-secondary)]'
            }`}
          >
            Invoices ({invoices.length})
          </button>
        </div>

        <div className="flex gap-2">
          {activeSubTab === 'client-pos' && (
            <button
              onClick={() => setShowCreatePO(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Client PO
            </button>
          )}
          {activeSubTab === 'invoices' && clientPOs.length > 0 && (
            <button
              onClick={() => setShowGenerateInvoice(true)}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Generate Invoice
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {activeSubTab === 'client-pos' && (
        <ClientPOList
          projectId={projectId}
          clientPOs={clientPOs}
          onRefresh={fetchClientPOs}
        />
      )}

      {activeSubTab === 'invoices' && (
        <CustomerInvoiceList
          projectId={projectId}
          invoices={invoices}
          summary={invoiceSummary}
          onRefresh={fetchInvoices}
        />
      )}

      {/* Modals */}
      {showCreatePO && (
        <ClientPOCreateModal
          projectId={projectId}
          onClose={() => setShowCreatePO(false)}
          onCreated={handlePOCreated}
        />
      )}

      {showGenerateInvoice && (
        <InvoiceGenerationModal
          projectId={projectId}
          clientPOs={clientPOs.filter(po => po.status === 'active')}
          onClose={() => setShowGenerateInvoice(false)}
          onGenerated={handleInvoiceGenerated}
        />
      )}
    </div>
  );
}
