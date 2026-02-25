/**
 * Bank Transactions — Sage "Process Bank" equivalent
 * Bank selector, balance header, New/Reviewed tabs, inline allocation, batch actions
 */

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { BankTxTable } from '@/components/accounting/BankTxTable';
import {
  Loader2, AlertCircle, RefreshCw, CheckCheck, Upload, Download,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import Link from 'next/link';

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(n);
}

interface BankTx {
  id: string;
  transactionDate: string;
  description?: string;
  reference?: string;
  bankReference?: string;
  amount: number;
  status: string;
}
interface GLAccount {
  id: string;
  accountCode: string;
  accountName: string;
  accountSubtype?: string;
  level?: number;
}
interface BankAcct {
  id: string;
  accountCode: string;
  accountName: string;
  balance: number;
}

type Tab = 'new' | 'reviewed';
const PAGE_SIZE = 25;

export default function BankTransactionsPage() {
  const [transactions, setTransactions] = useState<BankTx[]>([]);
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAcct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedBank, setSelectedBank] = useState('');
  const [tab, setTab] = useState<Tab>('new');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rowSelections, setRowSelections] = useState<Record<string, string>>({});

  // Load bank accounts
  useEffect(() => {
    fetch('/api/accounting/bank-accounts').then(r => r.json()).then(json => {
      const data = json.data || json;
      const list = Array.isArray(data) ? data : [];
      setBankAccounts(list);
      if (list.length > 0) setSelectedBank(prev => prev || list[0].id);
    }).catch(() => {});
  }, []);

  // Load GL accounts for allocation
  useEffect(() => {
    fetch('/api/accounting/chart-of-accounts').then(r => r.json()).then(json => {
      const data = json.data || json;
      const list = Array.isArray(data) ? data : [];
      setGlAccounts(list.filter((a: GLAccount) =>
        a.accountSubtype !== 'bank' && (a.level === undefined || a.level === 3)
      ));
    }).catch(() => {});
  }, []);

  // Load transactions
  const loadTransactions = useCallback(async () => {
    if (!selectedBank) return;
    setIsLoading(true);
    setError('');
    try {
      const status = tab === 'new' ? 'imported' : 'matched';
      const offset = (page - 1) * PAGE_SIZE;
      const params = new URLSearchParams({
        bank_account_id: selectedBank,
        status,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const res = await fetch(`/api/accounting/bank-transactions?${params}`);
      const json = await res.json();
      const data = json.data || json;
      setTransactions(data.transactions || []);
      setTotal(data.total || 0);
    } catch {
      setError('Failed to load transactions');
    } finally {
      setIsLoading(false);
    }
  }, [selectedBank, tab, page]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
    setRowSelections({});
  }, [selectedBank, tab]);

  // API action helper
  const callAction = async (body: Record<string, string>) => {
    const res = await fetch('/api/accounting/bank-transactions-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || json.success === false) {
      throw new Error(json.message || json.error || 'Action failed');
    }
    return json;
  };

  const handleAccept = async (txId: string) => {
    const accountId = rowSelections[txId];
    if (!accountId) { toast.error('Select an account first'); return; }
    try {
      await callAction({ action: 'allocate', bankTransactionId: txId, contraAccountId: accountId });
      toast.success('Transaction allocated');
      loadTransactions();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  const handleExclude = async (txId: string) => {
    try {
      await callAction({ action: 'exclude', bankTransactionId: txId });
      toast.success('Transaction excluded');
      loadTransactions();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  const handleUnmatch = async (txId: string) => {
    try {
      await callAction({ action: 'unmatch', bankTransactionId: txId });
      toast.success('Allocation undone');
      loadTransactions();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  const handleBatchAccept = async () => {
    const toAccept = Array.from(selectedIds).filter(id => rowSelections[id]);
    if (toAccept.length === 0) {
      toast.error('Select transactions with accounts assigned');
      return;
    }
    let ok = 0, fail = 0;
    for (const txId of toAccept) {
      try {
        await callAction({ action: 'allocate', bankTransactionId: txId, contraAccountId: rowSelections[txId] });
        ok++;
      } catch { fail++; }
    }
    toast.success(`${ok} allocated${fail ? `, ${fail} failed` : ''}`);
    setSelectedIds(new Set());
    loadTransactions();
  };

  const bank = bankAccounts.find(b => b.id === selectedBank);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const allSelected = transactions.length > 0 && transactions.every(t => selectedIds.has(t.id));

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header — Bank selector + Balance */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] px-6 py-4">
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] mb-3">Banking</h1>
          <div className="flex items-center gap-8">
            <div>
              <label className="text-xs text-[var(--ff-text-tertiary)] block mb-1">Bank or Credit Card</label>
              <select value={selectedBank} onChange={e => setSelectedBank(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm">
                {bankAccounts.map(b => (
                  <option key={b.id} value={b.id}>{b.accountName} — {b.accountCode}</option>
                ))}
              </select>
            </div>
            {bank && (
              <>
                <div>
                  <p className={`text-2xl font-bold ${bank.balance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtCurrency(bank.balance)}
                  </p>
                  <p className="text-xs text-[var(--ff-text-tertiary)]">Bank Balance</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{total}</p>
                  <p className="text-xs text-[var(--ff-text-tertiary)]">
                    {tab === 'new' ? 'To be Reviewed' : 'Reviewed'}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tabs — New / Reviewed */}
        <div className="px-6 border-b border-[var(--ff-border-light)]">
          <div className="flex gap-0">
            {(['new', 'reviewed'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}>
                {t === 'new' ? 'New Transactions' : 'Reviewed Transactions'}
              </button>
            ))}
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-2 border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]/30 flex items-center gap-3 flex-wrap">
          <button onClick={() => loadTransactions()} title="Refresh"
            className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
            <RefreshCw className="h-3.5 w-3.5" /> Actions
          </button>
          {tab === 'new' && selectedIds.size > 0 && (
            <button onClick={handleBatchAccept}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 font-medium">
              <CheckCheck className="h-3.5 w-3.5" /> Accept Selected ({selectedIds.size})
            </button>
          )}
          <div className="border-l border-[var(--ff-border-light)] h-5 mx-1" />
          <Link href="/accounting/bank-reconciliation/import"
            className="flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--ff-border-light)] text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
            <Upload className="h-3.5 w-3.5" /> Import Bank Statements
          </Link>
          <button className="flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--ff-border-light)] text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          <span className="ml-auto text-xs text-[var(--ff-text-tertiary)]">
            Displaying {total > 0 ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
        </div>

        {/* Table */}
        <div className="px-4 py-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-red-400 py-8 justify-center">
              <AlertCircle className="h-5 w-5" /><span>{error}</span>
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-12 text-[var(--ff-text-secondary)]">
              No {tab === 'new' ? 'new' : 'reviewed'} transactions for this account
            </div>
          ) : (
            <BankTxTable
              transactions={transactions}
              glAccounts={glAccounts}
              selectedIds={selectedIds}
              rowSelections={rowSelections}
              allSelected={allSelected}
              tab={tab}
              onToggleSelect={toggleSelect}
              onSelectAll={() => setSelectedIds(
                allSelected ? new Set() : new Set(transactions.map(t => t.id))
              )}
              onSelectionChange={(txId, acctId) =>
                setRowSelections(prev => ({ ...prev, [txId]: acctId }))
              }
              onAccept={handleAccept}
              onExclude={handleExclude}
              onUnmatch={handleUnmatch}
            />
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-[var(--ff-border-light)] flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage(1)}
                className="px-2 py-1 rounded text-xs text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-secondary)] disabled:opacity-30">
                First
              </button>
              {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
                const p = totalPages <= 10
                  ? i + 1
                  : page <= 5 ? i + 1
                  : page >= totalPages - 4 ? totalPages - 9 + i
                  : page - 5 + i;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-7 h-7 rounded text-xs ${
                      p === page
                        ? 'bg-emerald-600 text-white font-bold'
                        : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-secondary)]'
                    }`}>
                    {p}
                  </button>
                );
              })}
              <button disabled={page >= totalPages} onClick={() => setPage(totalPages)}
                className="px-2 py-1 rounded text-xs text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-secondary)] disabled:opacity-30">
                Last
              </button>
            </div>
            <span className="text-xs text-[var(--ff-text-tertiary)]">
              Displaying {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
          </div>
        )}

        {/* Bottom bar — Mark as Reviewed (Sage-style) */}
        {tab === 'new' && transactions.length > 0 && (
          <div className="sticky bottom-0 bg-[var(--ff-bg-secondary)] border-t border-[var(--ff-border-light)] px-6 py-3 flex items-center justify-center gap-4">
            <button onClick={handleBatchAccept}
              disabled={selectedIds.size === 0}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
              Mark Selected as Reviewed ({selectedIds.size})
            </button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
