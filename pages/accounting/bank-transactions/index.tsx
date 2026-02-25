/**
 * Bank Transactions - Process Bank (Sage equivalent)
 * View imported transactions and allocate to GL accounts
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  ArrowLeftRight, Loader2, AlertCircle, Check, X, Filter,
  ChevronDown, ArrowUpRight, ArrowDownRight, Search,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);
}

function formatDate(d: string): string {
  if (!d) return '';
  const s = d.split('T')[0];
  return s || d;
}

interface BankTx {
  id: string;
  bankAccountId: string;
  transactionDate: string;
  amount: number;
  description?: string;
  reference?: string;
  status: 'imported' | 'matched' | 'reconciled' | 'excluded';
  bankAccountName?: string;
}

interface GLAccount {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
}

interface BankAccount {
  id: string;
  accountCode: string;
  accountName: string;
}

type StatusFilter = 'all' | 'imported' | 'matched' | 'excluded';

export default function BankTransactionsPage() {
  const [transactions, setTransactions] = useState<BankTx[]>([]);
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [selectedBank, setSelectedBank] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('imported');
  const [searchTerm, setSearchTerm] = useState('');

  // Allocation state
  const [allocatingId, setAllocatingId] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [allocDesc, setAllocDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [accountSearch, setAccountSearch] = useState('');

  // Load bank accounts list
  useEffect(() => {
    fetch('/api/accounting/bank-accounts')
      .then(r => r.json())
      .then(json => {
        const data = json.data || json;
        const list = Array.isArray(data) ? data : [];
        setBankAccounts(list);
        if (list.length > 0 && !selectedBank) {
          setSelectedBank(list[0].id);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load GL accounts for allocation dropdown
  useEffect(() => {
    fetch('/api/accounting/chart-of-accounts')
      .then(r => r.json())
      .then(json => {
        const data = json.data || json;
        const list = Array.isArray(data) ? data : [];
        // Exclude bank accounts from allocation targets (level 3 only)
        setGlAccounts(list.filter((a: GLAccount & { accountSubtype?: string; level?: number }) =>
          a.accountSubtype !== 'bank' && (a.level === undefined || a.level === 3)
        ));
      })
      .catch(() => {});
  }, []);

  // Load transactions
  const loadTransactions = useCallback(async () => {
    if (!selectedBank) return;
    setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        bank_account_id: selectedBank,
        limit: '500',
      });
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      const res = await fetch(`/api/accounting/bank-transactions?${params}`);
      const json = await res.json();
      const data = json.data || json;
      setTransactions(data.transactions || []);
    } catch {
      setError('Failed to load transactions');
    } finally {
      setIsLoading(false);
    }
  }, [selectedBank, statusFilter]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!searchTerm) return transactions;
    const term = searchTerm.toLowerCase();
    return transactions.filter(tx =>
      (tx.description || '').toLowerCase().includes(term) ||
      (tx.reference || '').toLowerCase().includes(term)
    );
  }, [transactions, searchTerm]);

  // Filtered GL accounts for dropdown
  const filteredAccounts = useMemo(() => {
    if (!accountSearch) return glAccounts.slice(0, 30);
    const term = accountSearch.toLowerCase();
    return glAccounts.filter(a =>
      a.accountCode.toLowerCase().includes(term) ||
      a.accountName.toLowerCase().includes(term)
    ).slice(0, 30);
  }, [glAccounts, accountSearch]);

  // Start allocating a transaction
  const startAllocate = (tx: BankTx) => {
    setAllocatingId(tx.id);
    setSelectedAccount('');
    setAllocDesc(tx.description || '');
    setAccountSearch('');
  };

  // Submit allocation
  const submitAllocate = async (txId: string) => {
    if (!selectedAccount) {
      toast.error('Select a GL account');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/accounting/bank-transactions-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'allocate',
          bankTransactionId: txId,
          contraAccountId: selectedAccount,
          description: allocDesc,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.success === false) {
        toast.error(json.message || json.error || 'Allocation failed');
        return;
      }
      toast.success('Transaction allocated');
      setAllocatingId(null);
      loadTransactions();
    } catch {
      toast.error('Allocation failed');
    } finally {
      setSaving(false);
    }
  };

  // Counts
  const importedCount = transactions.filter(t => t.status === 'imported').length;
  const matchedCount = transactions.filter(t => t.status === 'matched').length;

  const bankLabel = bankAccounts.find(b => b.id === selectedBank)?.accountName || '';

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <ArrowLeftRight className="h-6 w-6 text-blue-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Bank Transactions</h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  Process and allocate bank transactions to GL accounts
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="px-6 py-3 border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]/50 flex flex-wrap items-center gap-4">
          {/* Bank Account Select */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
            <select
              value={selectedBank}
              onChange={e => setSelectedBank(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm"
            >
              {bankAccounts.map(b => (
                <option key={b.id} value={b.id}>{b.accountCode} — {b.accountName}</option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-[var(--ff-bg-primary)] rounded-lg border border-[var(--ff-border-light)] p-0.5">
            {(['all', 'imported', 'matched', 'excluded'] as StatusFilter[]).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-blue-600 text-white'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="flex-1 max-w-xs relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
            <input
              type="text"
              placeholder="Search description..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm"
            />
          </div>

          {/* Counts */}
          <div className="ml-auto flex items-center gap-3 text-xs text-[var(--ff-text-tertiary)]">
            <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-400">{importedCount} unallocated</span>
            <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-400">{matchedCount} allocated</span>
            <span>{filtered.length} shown</span>
          </div>
        </div>

        {/* Transactions Table */}
        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-red-400 py-8 justify-center">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-[var(--ff-text-secondary)]">
              No {statusFilter === 'all' ? '' : statusFilter} transactions
              {bankLabel ? ` for ${bankLabel}` : ''}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)] text-[var(--ff-text-tertiary)] text-xs">
                    <th className="text-left py-2 px-3 font-medium w-28">Date</th>
                    <th className="text-left py-2 px-3 font-medium">Description</th>
                    <th className="text-right py-2 px-3 font-medium w-32">Amount</th>
                    <th className="text-center py-2 px-3 font-medium w-24">Status</th>
                    <th className="text-left py-2 px-3 font-medium w-64">Allocate To</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(tx => {
                    const isAllocating = allocatingId === tx.id;
                    const isOut = tx.amount < 0;

                    return (
                      <tr
                        key={tx.id}
                        className={`border-b border-[var(--ff-border-light)]/50 hover:bg-[var(--ff-bg-secondary)]/50 transition-colors ${
                          isAllocating ? 'bg-blue-500/5' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 text-[var(--ff-text-secondary)] font-mono text-xs">
                          {formatDate(tx.transactionDate)}
                        </td>
                        <td className="py-2.5 px-3 text-[var(--ff-text-primary)]">
                          {isAllocating ? (
                            <input
                              type="text"
                              value={allocDesc}
                              onChange={e => setAllocDesc(e.target.value)}
                              className="w-full px-2 py-1 rounded bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm"
                            />
                          ) : (
                            <span className="line-clamp-1">{tx.description || '—'}</span>
                          )}
                        </td>
                        <td className={`py-2.5 px-3 text-right font-mono font-medium ${isOut ? 'text-red-400' : 'text-emerald-400'}`}>
                          <span className="inline-flex items-center gap-1">
                            {isOut ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {formatCurrency(Math.abs(tx.amount))}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            tx.status === 'imported' ? 'bg-amber-500/10 text-amber-400' :
                            tx.status === 'matched' ? 'bg-emerald-500/10 text-emerald-400' :
                            tx.status === 'excluded' ? 'bg-gray-500/10 text-gray-400' :
                            'bg-blue-500/10 text-blue-400'
                          }`}>
                            {tx.status === 'matched' ? 'Allocated' : tx.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {tx.status === 'imported' && !isAllocating && (
                            <button
                              onClick={() => startAllocate(tx)}
                              className="px-3 py-1 rounded-md bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 text-xs font-medium"
                            >
                              Allocate
                            </button>
                          )}
                          {tx.status === 'matched' && (
                            <span className="text-xs text-emerald-400/60">Allocated</span>
                          )}
                          {isAllocating && (
                            <div className="flex items-center gap-2">
                              <div className="relative flex-1">
                                <input
                                  type="text"
                                  placeholder="Search account..."
                                  value={accountSearch || (selectedAccount ? glAccounts.find(a => a.id === selectedAccount)?.accountName || '' : '')}
                                  onChange={e => {
                                    setAccountSearch(e.target.value);
                                    if (selectedAccount) setSelectedAccount('');
                                  }}
                                  onFocus={() => { if (selectedAccount) { setAccountSearch(''); setSelectedAccount(''); }}}
                                  className="w-full px-2 py-1 rounded bg-[var(--ff-bg-primary)] border border-blue-500/50 text-[var(--ff-text-primary)] text-xs"
                                />
                                {!selectedAccount && (
                                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                    {filteredAccounts.map(a => (
                                      <button
                                        key={a.id}
                                        onClick={() => { setSelectedAccount(a.id); setAccountSearch(''); }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--ff-bg-primary)] text-xs flex items-center gap-2"
                                      >
                                        <span className="font-mono text-[var(--ff-text-tertiary)]">{a.accountCode}</span>
                                        <span className="text-[var(--ff-text-primary)]">{a.accountName}</span>
                                      </button>
                                    ))}
                                    {filteredAccounts.length === 0 && (
                                      <div className="px-3 py-2 text-xs text-[var(--ff-text-tertiary)]">No accounts found</div>
                                    )}
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => submitAllocate(tx.id)}
                                disabled={saving || !selectedAccount}
                                className="p-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white"
                                title="Confirm allocation"
                              >
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                              </button>
                              <button
                                onClick={() => setAllocatingId(null)}
                                className="p-1 rounded bg-red-600/20 hover:bg-red-600/30 text-red-400"
                                title="Cancel"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
