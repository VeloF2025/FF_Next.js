/**
 * Bank Statement Import Page
 * PRD-060 Phase 4: CSV upload + format detection
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import Link from 'next/link';
import { ArrowLeft, Upload, Loader2, AlertCircle, CheckCircle2, Landmark } from 'lucide-react';

interface BankAccount { id: string; account_code: string; account_name: string }

export default function BankStatementImportPage() {
  const router = useRouter();
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ batchId: string; transactionCount: number; errors: { row: number; error: string }[] } | null>(null);

  const [form, setForm] = useState({
    bankAccountId: '',
    statementDate: new Date().toISOString().split('T')[0],
    bankFormat: 'auto',
    csvContent: '',
    fileName: '',
  });

  useEffect(() => {
    // Load bank accounts (GL accounts with subtype='bank')
    fetch('/api/accounting/chart-of-accounts?subtype=bank')
      .then(r => r.json())
      .then(res => {
        const data = res.data || res;
        const accounts = Array.isArray(data) ? data : data.accounts || [];
        setBankAccounts(accounts.map((a: { id: string; accountCode?: string; account_code?: string; accountName?: string; account_name?: string }) => ({
          id: a.id,
          account_code: a.accountCode || a.account_code || '',
          account_name: a.accountName || a.account_name || '',
        })));
      });
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setForm(f => ({
        ...f,
        csvContent: ev.target?.result as string || '',
        fileName: file.name,
      }));
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/accounting/bank-transactions-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          csvContent: form.csvContent,
          bankAccountId: form.bankAccountId,
          statementDate: form.statementDate,
          bankFormat: form.bankFormat === 'auto' ? undefined : form.bankFormat,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.message || json.error || 'Import failed');
      setResult(json.data || json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <Link href="/accounting/bank-reconciliation" className="inline-flex items-center gap-1 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] mb-2">
              <ArrowLeft className="h-4 w-4" /> Back to Reconciliations
            </Link>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Upload className="h-6 w-6 text-emerald-500" />
              </div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Import Bank Statement</h1>
            </div>
          </div>
        </div>

        <div className="p-6 max-w-3xl space-y-6">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}

          {result && (
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-medium">
                <CheckCircle2 className="h-5 w-5" /> Import Successful
              </div>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                Imported {result.transactionCount} transaction{result.transactionCount !== 1 ? 's' : ''}
              </p>
              {result.errors.length > 0 && (
                <div className="text-sm text-amber-400">
                  {result.errors.length} row{result.errors.length !== 1 ? 's' : ''} skipped:
                  <ul className="list-disc ml-5 mt-1 text-xs">
                    {result.errors.slice(0, 5).map((e, i) => (
                      <li key={i}>Row {e.row}: {e.error}</li>
                    ))}
                    {result.errors.length > 5 && <li>...and {result.errors.length - 5} more</li>}
                  </ul>
                </div>
              )}
              <div className="pt-2">
                <Link
                  href="/accounting/bank-reconciliation"
                  className="text-sm text-emerald-500 hover:text-emerald-400 font-medium"
                >
                  Start a reconciliation with these transactions
                </Link>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6 space-y-4">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Statement Details</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Bank Account *</label>
                  <select
                    value={form.bankAccountId}
                    onChange={e => setForm(f => ({ ...f, bankAccountId: e.target.value }))}
                    className="ff-select w-full"
                    required
                  >
                    <option value="">Select bank account...</option>
                    {bankAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Statement Date *</label>
                  <input
                    type="date"
                    value={form.statementDate}
                    onChange={e => setForm(f => ({ ...f, statementDate: e.target.value }))}
                    className="ff-input w-full"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Bank Format</label>
                  <select
                    value={form.bankFormat}
                    onChange={e => setForm(f => ({ ...f, bankFormat: e.target.value }))}
                    className="ff-select w-full"
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="fnb">FNB</option>
                    <option value="standard_bank">Standard Bank</option>
                    <option value="nedbank">Nedbank</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6 space-y-4">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">CSV File</h2>

              <div className="border-2 border-dashed border-[var(--ff-border-light)] rounded-lg p-8 text-center">
                <Landmark className="h-8 w-8 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
                <label className="block">
                  <span className="text-emerald-500 hover:text-emerald-400 cursor-pointer font-medium">
                    Choose CSV file
                  </span>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
                {form.fileName && (
                  <p className="mt-2 text-sm text-[var(--ff-text-secondary)]">{form.fileName}</p>
                )}
                <p className="mt-1 text-xs text-[var(--ff-text-tertiary)]">
                  Supports FNB, Standard Bank, and Nedbank CSV formats
                </p>
              </div>

              {form.csvContent && (
                <div className="text-sm text-[var(--ff-text-secondary)]">
                  {form.csvContent.split('\n').length - 1} data rows detected
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <Link href="/accounting/bank-reconciliation" className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={isSubmitting || !form.csvContent || !form.bankAccountId}
                className="inline-flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm font-medium"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Import Statement
              </button>
            </div>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}
