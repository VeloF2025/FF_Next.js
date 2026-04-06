'use client';

/**
 * Record Payment Form
 * Inline form for adding a new contractor payment.
 * Used inside ContractorPayments component.
 */

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { recordContractorPayment } from '@/services/contractor/contractorPaymentsService';
import type { ContractorPaymentFormData } from '@/types/contractor-payment.types';
import type { ContractorProjectWithDetails } from '@/types/contractor-project.types';
import { log } from '@/lib/logger';

interface RecordPaymentFormProps {
  contractorId: string;
  contractorProjects: ContractorProjectWithDetails[];
  onSuccess: () => void;
  onCancel: () => void;
}

export function RecordPaymentForm({ contractorId, contractorProjects, onSuccess, onCancel }: RecordPaymentFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<ContractorPaymentFormData>({
    amount: 0,
    paymentDate: new Date().toISOString().split('T')[0]!,
    reference: '',
    notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!form.amount || form.amount <= 0) {
      setFormError('Amount must be greater than 0');
      return;
    }
    if (!form.paymentDate) {
      setFormError('Payment date is required');
      return;
    }

    setSubmitting(true);
    try {
      await recordContractorPayment(contractorId, {
        ...form,
        reference: form.reference || undefined,
        notes: form.notes || undefined,
      });
      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to record payment';
      log.error('Failed to record payment', { error: err, contractorId }, 'RecordPaymentForm');
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-[var(--ff-border-light)] rounded-lg p-4 bg-[var(--ff-bg-tertiary)]"
    >
      <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] mb-4">Record Payment</h3>

      {formError && (
        <div className="mb-4 flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Amount */}
        <div>
          <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
            Amount (ZAR) <span className="text-red-400">*</span>
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            required
            value={form.amount || ''}
            onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            placeholder="0.00"
          />
        </div>

        {/* Payment Date */}
        <div>
          <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
            Payment Date <span className="text-red-400">*</span>
          </label>
          <input
            type="date"
            required
            value={form.paymentDate}
            onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
            className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>

        {/* Reference */}
        <div>
          <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
            Reference / Invoice #
          </label>
          <input
            type="text"
            value={form.reference || ''}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            placeholder="INV-001 or bank reference"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
            Notes
          </label>
          <input
            type="text"
            value={form.notes || ''}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            placeholder="Optional notes"
          />
        </div>

        {/* Project Assignment */}
        {contractorProjects.length > 0 && (
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
              Project Assignment
            </label>
            <select
              value={form.contractorProjectId ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  contractorProjectId: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="">— Not linked to a project —</option>
              {contractorProjects.map((cp) => (
                <option key={cp.id} value={cp.id}>
                  {cp.projectName} ({cp.projectCode}) — {cp.role}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mt-4">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Recording...' : 'Record Payment'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
