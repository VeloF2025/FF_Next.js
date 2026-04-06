'use client';

/**
 * Create Invoice Modal
 * Form for submitting a new contractor invoice with dynamic line items.
 * Supports bundling approved progress claims into the invoice.
 * Used on the contractor invoices list page.
 */

import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, AlertCircle, CheckSquare, Square } from 'lucide-react';
import { createContractorInvoice } from '@/services/contractor/contractorInvoicesService';
import { getContractorProjectsByContractor } from '@/services/contractor/contractorProjectsService';
import { getContractorClaims } from '@/services/contractor/contractorClaimsService';
import type { ContractorInvoiceFormData, InvoiceLineItem, ContractorInvoiceWithDetails } from '@/types/contractor-invoice.types';
import type { ContractorProjectWithDetails } from '@/types/contractor-project.types';
import type { ContractorProgressClaimWithDetails } from '@/types/contractor-progress-claim.types';
import { log } from '@/lib/logger';

interface CreateInvoiceModalProps {
  contractorId: string;
  onClose: () => void;
  onCreated: (invoice: ContractorInvoiceWithDetails) => void;
}

const EMPTY_LINE_ITEM: InvoiceLineItem = { description: '', quantity: 1, unit_price: 0, amount: 0 };
const fmt = (n: number) => `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`;
const INPUT_CLS = 'px-2 py-1.5 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-full';

// ==================== Line Items Editor ====================

interface LineItemsEditorProps {
  lineItems: InvoiceLineItem[];
  onUpdate: (index: number, patch: Partial<InvoiceLineItem>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

function LineItemsEditor({ lineItems, onUpdate, onAdd, onRemove }: LineItemsEditorProps) {
  const total = lineItems.reduce((sum, item) => sum + (item.amount || 0), 0);
  return (
    <div className="rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
      <div className="grid grid-cols-[1fr_80px_100px_100px_36px] gap-2 px-3 py-2 bg-[var(--ff-bg-tertiary)] text-xs text-[var(--ff-text-secondary)] font-medium">
        <span>Description</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Unit Price</span>
        <span className="text-right">Amount</span>
        <span />
      </div>
      <div className="divide-y divide-[var(--ff-border-light)]">
        {lineItems.map((item, i) => (
          <div key={i} className="grid grid-cols-[1fr_80px_100px_100px_36px] gap-2 px-3 py-2 items-center bg-[var(--ff-bg-secondary)]">
            <input type="text" value={item.description} onChange={(e) => onUpdate(i, { description: e.target.value })} placeholder="Description" className={INPUT_CLS} />
            <input type="number" min="0.001" step="any" value={item.quantity || ''} onChange={(e) => onUpdate(i, { quantity: parseFloat(e.target.value) || 0 })} className={`${INPUT_CLS} text-right`} placeholder="1" />
            <input type="number" min="0" step="0.01" value={item.unit_price || ''} onChange={(e) => onUpdate(i, { unit_price: parseFloat(e.target.value) || 0 })} className={`${INPUT_CLS} text-right`} placeholder="0.00" />
            <div className="text-xs text-right text-[var(--ff-text-secondary)] font-medium">{fmt(item.amount)}</div>
            <button type="button" onClick={() => onRemove(i)} disabled={lineItems.length === 1} className="p-1 rounded hover:bg-red-500/20 text-[var(--ff-text-tertiary)] hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed" title="Remove line item">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_80px_100px_100px_36px] gap-2 px-3 py-2.5 bg-[var(--ff-bg-tertiary)] border-t border-[var(--ff-border-light)]">
        <div className="col-span-3 text-right text-sm font-semibold text-[var(--ff-text-primary)]">Total</div>
        <div className="text-right font-bold text-[var(--ff-text-primary)] text-sm">{fmt(total)}</div>
        <div />
      </div>
      <div className="px-3 py-2 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
          <Plus className="h-3 w-3" /> Add Item
        </button>
      </div>
    </div>
  );
}

// ==================== Approved Claims Selector ====================

interface ClaimsSelectorProps {
  claims: ContractorProgressClaimWithDetails[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}

function ClaimsSelector({ claims, selectedIds, onToggle }: ClaimsSelectorProps) {
  if (claims.length === 0) {
    return (
      <p className="text-xs text-[var(--ff-text-tertiary)] italic py-2">
        No approved claims available to bundle.
      </p>
    );
  }

  const selectedTotal = claims
    .filter((c) => selectedIds.has(c.id))
    .reduce((s, c) => s + (c.amountApproved ?? c.amountClaimed), 0);

  return (
    <div className="rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
      <div className="divide-y divide-[var(--ff-border-light)]">
        {claims.map((claim) => {
          const checked = selectedIds.has(claim.id);
          const amount = claim.amountApproved ?? claim.amountClaimed;
          return (
            <button
              key={claim.id}
              type="button"
              onClick={() => onToggle(claim.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                checked ? 'bg-green-500/10' : 'bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)]'
              }`}
            >
              {checked ? (
                <CheckSquare className="h-4 w-4 text-green-400 shrink-0" />
              ) : (
                <Square className="h-4 w-4 text-[var(--ff-text-tertiary)] shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-[var(--ff-text-primary)]">
                  Claim #{claim.claimNumber}
                  {claim.projectCode && (
                    <span className="ml-1 text-[var(--ff-text-tertiary)]">({claim.projectCode})</span>
                  )}
                </div>
                <div className="text-xs text-[var(--ff-text-secondary)] truncate">{claim.description}</div>
              </div>
              <div className="text-xs font-semibold text-green-400 whitespace-nowrap">{fmt(amount)}</div>
            </button>
          );
        })}
      </div>
      {selectedIds.size > 0 && (
        <div className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border-t border-[var(--ff-border-light)] flex items-center justify-between">
          <span className="text-xs text-[var(--ff-text-secondary)]">{selectedIds.size} claim{selectedIds.size !== 1 ? 's' : ''} selected</span>
          <span className="text-xs font-bold text-green-400">{fmt(selectedTotal)}</span>
        </div>
      )}
    </div>
  );
}

// ==================== Modal ====================

export function CreateInvoiceModal({ contractorId, onClose, onCreated }: CreateInvoiceModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ContractorProjectWithDetails[]>([]);
  const [approvedClaims, setApprovedClaims] = useState<ContractorProgressClaimWithDetails[]>([]);
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<string>>(new Set());
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [contractorProjectId, setContractorProjectId] = useState<number | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([{ ...EMPTY_LINE_ITEM }]);

  const loadData = useCallback(async () => {
    try {
      const [projectsList, claimsResult] = await Promise.all([
        getContractorProjectsByContractor(contractorId),
        getContractorClaims({ contractorId, status: 'approved' }),
      ]);
      setProjects(projectsList);
      setApprovedClaims(claimsResult.data);
    } catch (err: unknown) {
      log.error('Failed to load data for invoice modal', { error: err, contractorId }, 'CreateInvoiceModal');
    }
  }, [contractorId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toggleClaim = (id: string) => {
    setSelectedClaimIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const updateLineItem = (index: number, patch: Partial<InvoiceLineItem>) => {
    setLineItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[index]!, ...patch };
      if ('quantity' in patch || 'unit_price' in patch) {
        item.amount = parseFloat((item.quantity * item.unit_price).toFixed(2));
      }
      updated[index] = item;
      return updated;
    });
  };

  const lineItemsTotal = lineItems.reduce((sum, item) => sum + (item.amount || 0), 0);
  const selectedClaimsTotal = approvedClaims
    .filter((c) => selectedClaimIds.has(c.id))
    .reduce((s, c) => s + (c.amountApproved ?? c.amountClaimed), 0);
  const totalAmount = parseFloat((lineItemsTotal + selectedClaimsTotal).toFixed(2));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!invoiceNumber.trim()) { setFormError('Invoice number is required'); return; }
    if (lineItems.length === 0) { setFormError('At least one line item is required'); return; }

    for (const item of lineItems) {
      if (!item.description.trim()) { setFormError('All line items must have a description'); return; }
      if (item.quantity <= 0) { setFormError('Line item quantity must be greater than 0'); return; }
      if (item.unit_price <= 0) { setFormError('Line item unit price must be greater than 0'); return; }
    }

    const payload: ContractorInvoiceFormData = {
      invoiceNumber: invoiceNumber.trim(),
      lineItems,
      totalAmount,
      contractorProjectId,
      notes: notes.trim() || undefined,
      claimIds: selectedClaimIds.size > 0 ? Array.from(selectedClaimIds) : undefined,
    };

    setSubmitting(true);
    try {
      const created = await createContractorInvoice(contractorId, payload);
      onCreated(created);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create invoice';
      log.error('Failed to create invoice', { error: err, contractorId }, 'CreateInvoiceModal');
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)] shrink-0">
          <h2 className="text-base font-bold text-[var(--ff-text-primary)]">New Invoice</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {formError && (
              <div className="flex items-center gap-2 text-red-400 text-sm p-3 bg-red-500/10 rounded-lg border border-red-500/30">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Invoice number + project */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                  Invoice Number <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="INV-001"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">Project Assignment</label>
                <select
                  value={contractorProjectId ?? ''}
                  onChange={(e) => setContractorProjectId(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="">— Not linked to a project —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.projectName} ({p.projectCode}) — {p.role}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Approved claims bundling */}
            <div>
              <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-2">
                Bundle Approved Claims
                <span className="ml-1 font-normal text-[var(--ff-text-tertiary)]">(optional)</span>
              </label>
              <ClaimsSelector
                claims={approvedClaims}
                selectedIds={selectedClaimIds}
                onToggle={toggleClaim}
              />
            </div>

            {/* Line items */}
            <div>
              <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-2">
                Line Items <span className="text-red-400">*</span>
              </label>
              <LineItemsEditor
                lineItems={lineItems}
                onUpdate={updateLineItem}
                onAdd={() => setLineItems((prev) => [...prev, { ...EMPTY_LINE_ITEM }])}
                onRemove={(i) => setLineItems((prev) => prev.filter((_, idx) => idx !== i))}
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                placeholder="Optional notes or references"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 px-6 py-4 border-t border-[var(--ff-border-light)] flex items-center justify-between bg-[var(--ff-bg-secondary)]">
            <div className="text-sm text-[var(--ff-text-secondary)]">
              Total:{' '}
              <span className="font-bold text-[var(--ff-text-primary)]">{fmt(totalAmount)}</span>
              {selectedClaimIds.size > 0 && (
                <span className="ml-2 text-xs text-green-400">
                  (incl. {selectedClaimIds.size} claim{selectedClaimIds.size !== 1 ? 's' : ''}: {fmt(selectedClaimsTotal)})
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium">
                {submitting ? 'Submitting...' : 'Submit Invoice'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
