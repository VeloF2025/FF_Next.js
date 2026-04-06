'use client';

/**
 * Contractor Payments Component
 * Displays payment history and allows recording new payments.
 * Used on the contractor detail page.
 */

import { useState, useEffect, useCallback } from 'react';
import { Plus, DollarSign, Download, AlertCircle, Calendar, FileText } from 'lucide-react';
import {
  getContractorPayments,
  buildCsvExportUrl,
} from '@/services/contractor/contractorPaymentsService';
import { getContractorProjectsByContractor } from '@/services/contractor/contractorProjectsService';
import { RecordPaymentForm } from './RecordPaymentForm';
import type { ContractorPaymentWithDetails } from '@/types/contractor-payment.types';
import type { ContractorProjectWithDetails } from '@/types/contractor-project.types';
import { log } from '@/lib/logger';

interface ContractorPaymentsProps {
  contractorId: string;
}

// ==================== Payment Row ====================

interface PaymentRowProps {
  payment: ContractorPaymentWithDetails;
}

function PaymentRow({ payment }: PaymentRowProps) {
  const dateStr = payment.paymentDate.toISOString().split('T')[0];

  return (
    <div className="flex items-start justify-between py-3 border-b border-[var(--ff-border-light)] last:border-0">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-green-500/10 rounded-lg mt-0.5">
          <DollarSign className="h-4 w-4 text-green-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[var(--ff-text-primary)]">
              R {payment.amount.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
            </span>
            {payment.reference && (
              <span className="text-xs text-[var(--ff-text-tertiary)] bg-[var(--ff-bg-tertiary)] px-2 py-0.5 rounded">
                {payment.reference}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)] mt-1">
            <Calendar className="h-3 w-3" />
            <span>{dateStr}</span>
          </div>

          {payment.projectName && (
            <div className="flex items-center gap-1 text-xs text-[var(--ff-text-tertiary)] mt-0.5">
              <FileText className="h-3 w-3" />
              <span>
                {payment.projectName}
                {payment.projectCode ? ` (${payment.projectCode})` : ''}
                {payment.role ? ` — ${payment.role}` : ''}
              </span>
            </div>
          )}

          {payment.notes && (
            <p className="text-xs text-[var(--ff-text-secondary)] mt-1 italic">{payment.notes}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== Main Component ====================

export function ContractorPayments({ contractorId }: ContractorPaymentsProps) {
  const [payments, setPayments] = useState<ContractorPaymentWithDetails[]>([]);
  const [contractorProjects, setContractorProjects] = useState<ContractorProjectWithDetails[]>([]);
  const [totalPaid, setTotalPaid] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const loadPayments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [result, projects] = await Promise.all([
        getContractorPayments({
          contractorId,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
        }),
        getContractorProjectsByContractor(contractorId),
      ]);
      setPayments(result.data);
      setTotalPaid(result.summary.totalPaid);
      setContractorProjects(projects);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load payments';
      log.error('Error loading contractor payments', { error: err, contractorId }, 'ContractorPayments');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [contractorId, fromDate, toDate]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  const csvUrl = buildCsvExportUrl(contractorId, {
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
  });

  if (loading) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-1/4"></div>
          <div className="h-16 bg-[var(--ff-bg-tertiary)] rounded"></div>
          <div className="h-16 bg-[var(--ff-bg-tertiary)] rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Payment History
          </h2>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            {payments.length} payment{payments.length !== 1 ? 's' : ''} &mdash; Total paid:{' '}
            <span className="text-green-400 font-semibold">
              R {totalPaid.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={csvUrl}
            download
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]"
            title="Export to CSV"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </a>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              <Plus className="h-4 w-4" />
              Record Payment
            </button>
          )}
        </div>
      </div>

      {/* Date range filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
        <span className="text-xs text-[var(--ff-text-secondary)]">Filter by date:</span>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--ff-text-secondary)]">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="px-2 py-1 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--ff-text-secondary)]">To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="px-2 py-1 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        {(fromDate || toDate) && (
          <button
            onClick={() => { setFromDate(''); setToDate(''); }}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            Clear
          </button>
        )}
      </div>

      {/* Add Payment Form */}
      {showAddForm && (
        <div className="mb-6">
          <RecordPaymentForm
            contractorId={contractorId}
            contractorProjects={contractorProjects}
            onSuccess={() => { setShowAddForm(false); loadPayments(); }}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      {/* Payment list */}
      {payments.length === 0 ? (
        <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
          <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No payments recorded yet</p>
          <p className="text-sm mt-1">Click &ldquo;Record Payment&rdquo; to add the first payment</p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--ff-border-light)]">
          {payments.map((payment) => (
            <PaymentRow key={payment.id} payment={payment} />
          ))}
        </div>
      )}
    </div>
  );
}
