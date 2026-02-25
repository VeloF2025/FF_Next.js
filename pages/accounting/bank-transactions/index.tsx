/**
 * Bank Transactions — Sage "Process Bank" equivalent
 * Type: Account / Supplier / Customer — Selection changes accordingly
 * Full toolbar: Mark Reviewed, Delete, Batch Edit, Import, Export, Search
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  BankTxTable, type AllocType, type BankTx, type SelectOption, type RowSelection,
} from '@/components/accounting/BankTxTable';
import {
  Loader2, AlertCircle, RefreshCw, CheckCheck, Upload, Download, Search, Trash2, Layers,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import Link from 'next/link';

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(n);
}

interface BankAcct { id: string; accountCode: string; accountName: string; balance: number; }
type Tab = 'new' | 'reviewed';
const PAGE_SIZE = 25;

export default function BankTransactionsPage() {
  const [transactions, setTransactions] = useState<BankTx[]>([]);
  const [glAccounts, setGlAccounts] = useState<SelectOption[]>([]);
  const [suppliers, setSuppliers] = useState<SelectOption[]>([]);
  const [customers, setCustomers] = useState<SelectOption[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAcct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedBank, setSelectedBank] = useState('');
  const [tab, setTab] = useState<Tab>('new');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rowSelections, setRowSelections] = useState<Record<string, RowSelection>>({});
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const [batchType, setBatchType] = useState<AllocType>('account');
  const [batchSearch, setBatchSearch] = useState('');

  // Load reference data — bank accounts, GL accounts, suppliers, customers
  useEffect(() => {
    fetch('/api/accounting/bank-accounts').then(r => r.json()).then(json => {
      const list = Array.isArray(json.data || json) ? (json.data || json) : [];
      setBankAccounts(list);
      if (list.length > 0) setSelectedBank(prev => prev || list[0].id);
    }).catch(() => {});

    fetch('/api/accounting/chart-of-accounts').then(r => r.json()).then(json => {
      const list = Array.isArray(json.data || json) ? (json.data || json) : [];
      setGlAccounts(list
        .filter((a: SelectOption & { accountSubtype?: string; level?: number }) =>
          a.accountSubtype !== 'bank' && (a.level === undefined || a.level === 3))
        .map((a: SelectOption & { accountCode?: string; accountName?: string }) => ({
          id: a.id, code: a.accountCode || a.code, name: a.accountName || a.name,
        }))
      );
    }).catch(() => {});

    fetch('/api/suppliers?status=active').then(r => r.json()).then(json => {
      const list = Array.isArray(json.data) ? json.data : [];
      setSuppliers(list.map((s: { id: number | string; name: string; code?: string }) => ({
        id: String(s.id), name: s.name, code: s.code,
      })));
    }).catch(() => {});

    fetch('/api/clients').then(r => r.json()).then(json => {
      const list = Array.isArray(json.data) ? json.data : [];
      setCustomers(list.map((c: { id: string; name?: string; company_name?: string; companyName?: string }) => ({
        id: c.id, name: c.company_name || c.companyName || c.name || '',
      })));
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
        bank_account_id: selectedBank, status, limit: String(PAGE_SIZE), offset: String(offset),
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

  // API helpers
  const callAction = async (body: Record<string, string>) => {
    const res = await fetch('/api/accounting/bank-transactions-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || json.success === false) throw new Error(json.message || json.error || 'Action failed');
    return json;
  };

  const handleAccept = async (txId: string) => {
    const sel = rowSelections[txId];
    if (!sel?.entityId) { toast.error('Select an account/supplier/customer first'); return; }
    try {
      const body: Record<string, string> = {
        action: 'allocate', bankTransactionId: txId, allocationType: sel.type,
      };
      if (sel.type === 'account') body.contraAccountId = sel.entityId;
      else body.entityId = sel.entityId;
      await callAction(body);
      toast.success('Transaction allocated');
      loadTransactions();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  const handleExclude = async (txId: string) => {
    try {
      await callAction({ action: 'exclude', bankTransactionId: txId });
      toast.success('Excluded');
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
    const toAccept = Array.from(selectedIds).filter(id => rowSelections[id]?.entityId);
    if (toAccept.length === 0) { toast.error('Select transactions with accounts assigned'); return; }
    let ok = 0, fail = 0;
    for (const txId of toAccept) {
      try {
        const sel = rowSelections[txId];
        const body: Record<string, string> = {
          action: 'allocate', bankTransactionId: txId, allocationType: sel.type,
        };
        if (sel.type === 'account') body.contraAccountId = sel.entityId;
        else body.entityId = sel.entityId;
        await callAction(body);
        ok++;
      } catch { fail++; }
    }
    toast.success(`${ok} allocated${fail ? `, ${fail} failed` : ''}`);
    setSelectedIds(new Set());
    loadTransactions();
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    // TODO: implement delete API endpoint
    toast.error('Delete not yet implemented');
  };

  const handleExport = () => {
    const rows = filtered.map(tx => ({
      Date: tx.transactionDate,
      Description: tx.description || '',
      Reference: tx.reference || '',
      Spent: tx.amount < 0 ? Math.abs(tx.amount) : '',
      Received: tx.amount > 0 ? tx.amount : '',
      Status: tx.status,
    }));
    const header = Object.keys(rows[0] || {}).join(',');
    const csv = [header, ...rows.map(r => Object.values(r).map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bank-transactions-${bank?.accountCode || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Apply batch edit selection to all selected rows
  const applyBatchEdit = (entityId: string, label: string) => {
    const updates: Record<string, RowSelection> = { ...rowSelections };
    selectedIds.forEach(id => {
      updates[id] = { type: batchType, entityId, label };
    });
    setRowSelections(updates);
    setShowBatchEdit(false);
    toast.success(`Applied ${batchType} "${label}" to ${selectedIds.size} rows`);
  };

  // Search filter (client-side within current page)
  const filtered = useMemo(() => {
    if (!searchTerm) return transactions;
    const t = searchTerm.toLowerCase();
    return transactions.filter(tx =>
      (tx.description || '').toLowerCase().includes(t) ||
      (tx.reference || '').toLowerCase().includes(t)
    );
  }, [transactions, searchTerm]);

  const bank = bankAccounts.find(b => b.id === selectedBank);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const allSelected = filtered.length > 0 && filtered.every(t => selectedIds.has(t.id));

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // Batch edit options
  const batchOptions = useMemo(() => {
    const opts = batchType === 'supplier' ? suppliers : batchType === 'customer' ? customers : glAccounts;
    if (!batchSearch) return opts.slice(0, 30);
    const q = batchSearch.toLowerCase();
    return opts.filter(o => (o.code || '').toLowerCase().includes(q) || o.name.toLowerCase().includes(q)).slice(0, 30);
  }, [batchType, batchSearch, glAccounts, suppliers, customers]);

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header — bank account cards */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] px-6 py-4">
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] mb-3">Banking</h1>
          <div className="flex items-center gap-3 flex-wrap">
            {bankAccounts.map(b => {
              const active = b.id === selectedBank;
              return (
                <button key={b.id} onClick={() => setSelectedBank(b.id)}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border-2 transition-all text-left ${
                    active
                      ? 'border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-500/10'
                      : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] hover:border-[var(--ff-text-tertiary)]'
                  }`}>
                  <div className={`w-2 h-8 rounded-full shrink-0 ${active ? 'bg-emerald-500' : 'bg-[var(--ff-border-light)]'}`} />
                  <div>
                    <p className={`text-sm font-semibold ${active ? 'text-emerald-400' : 'text-[var(--ff-text-primary)]'}`}>
                      {b.accountName}
                    </p>
                    <p className="text-xs text-[var(--ff-text-tertiary)] font-mono">{b.accountCode}</p>
                  </div>
                  <div className="ml-3 text-right">
                    <p className={`text-sm font-bold font-mono ${b.balance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmtCurrency(b.balance)}
                    </p>
                  </div>
                </button>
              );
            })}
            {bank && (
              <div className="ml-auto flex items-center gap-6">
                <div className="text-right">
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{total}</p>
                  <p className="text-xs text-[var(--ff-text-tertiary)]">
                    {tab === 'new' ? 'To be Reviewed' : 'Reviewed'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
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

        {/* Toolbar — matches Sage: Actions | Mark Reviewed | Delete | Batch Edit | Import | Export | Search */}
        <div className="px-6 py-2 border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]/30 flex items-center gap-2 flex-wrap">
          <button onClick={() => loadTransactions()} title="Refresh"
            className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
            <RefreshCw className="h-3.5 w-3.5" /> Actions
          </button>
          {tab === 'new' && (
            <>
              <button onClick={handleBatchAccept}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] disabled:opacity-30">
                <CheckCheck className="h-3.5 w-3.5" /> Mark as Reviewed
              </button>
              <button onClick={handleBatchDelete}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] disabled:opacity-30">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
              <button onClick={() => { setShowBatchEdit(!showBatchEdit); setBatchSearch(''); }}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] disabled:opacity-30">
                <Layers className="h-3.5 w-3.5" /> Batch Edit
              </button>
            </>
          )}
          <div className="border-l border-[var(--ff-border-light)] h-5 mx-1" />
          <Link href="/accounting/bank-reconciliation/import"
            className="flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--ff-border-light)] text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
            <Upload className="h-3.5 w-3.5" /> Import Bank Statements
          </Link>
          <button onClick={handleExport}
            className="flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--ff-border-light)] text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          {/* Search */}
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ff-text-tertiary)]" />
              <input type="text" placeholder="Search..." value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-7 pr-3 py-1 rounded-lg bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-xs text-[var(--ff-text-primary)] w-44" />
            </div>
            <span className="text-xs text-[var(--ff-text-tertiary)]">
              {total > 0 ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)}` : '0'} of {total}
            </span>
          </div>
        </div>

        {/* Batch Edit Panel */}
        {showBatchEdit && selectedIds.size > 0 && (
          <div className="px-6 py-3 border-b border-blue-500/30 bg-blue-500/5 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-blue-400 font-medium">Batch Edit ({selectedIds.size} selected):</span>
            <select value={batchType} onChange={e => { setBatchType(e.target.value as AllocType); setBatchSearch(''); }}
              className="text-xs px-2 py-1 rounded bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]">
              <option value="account">Account</option>
              <option value="supplier">Supplier</option>
              <option value="customer">Customer</option>
            </select>
            <div className="relative">
              <input type="text" placeholder={`Search ${batchType}s...`} value={batchSearch}
                onChange={e => setBatchSearch(e.target.value)}
                className="pl-2 pr-2 py-1 rounded bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-xs text-[var(--ff-text-primary)] w-52" />
              {batchSearch && (
                <div className="absolute z-50 top-full left-0 mt-1 w-72 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-xl max-h-48 overflow-y-auto">
                  {batchOptions.map(o => (
                    <button key={o.id} onClick={() => applyBatchEdit(o.id, o.code ? `${o.code} ${o.name}` : o.name)}
                      className="w-full text-left px-3 py-1.5 hover:bg-[var(--ff-bg-primary)] text-xs flex items-center gap-2">
                      {o.code && <span className="font-mono text-[var(--ff-text-tertiary)]">{o.code}</span>}
                      <span className="text-[var(--ff-text-primary)]">{o.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setShowBatchEdit(false)}
              className="text-xs text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]">Cancel</button>
          </div>
        )}

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
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-[var(--ff-text-secondary)]">
              No {tab === 'new' ? 'new' : 'reviewed'} transactions for this account
            </div>
          ) : (
            <BankTxTable
              transactions={filtered}
              glAccounts={glAccounts}
              suppliers={suppliers}
              customers={customers}
              selectedIds={selectedIds}
              rowSelections={rowSelections}
              allSelected={allSelected}
              tab={tab}
              onToggleSelect={toggleSelect}
              onSelectAll={() => setSelectedIds(
                allSelected ? new Set() : new Set(filtered.map(t => t.id))
              )}
              onRowTypeChange={(txId, type) =>
                setRowSelections(prev => ({ ...prev, [txId]: { type, entityId: '', label: '' } }))
              }
              onRowEntityChange={(txId, entityId, label) =>
                setRowSelections(prev => ({
                  ...prev,
                  [txId]: { ...prev[txId], type: prev[txId]?.type || 'account', entityId, label },
                }))
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
                className="px-2 py-1 rounded text-xs text-[var(--ff-text-secondary)] disabled:opacity-30">First</button>
              {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
                const p = totalPages <= 10 ? i + 1
                  : page <= 5 ? i + 1
                  : page >= totalPages - 4 ? totalPages - 9 + i
                  : page - 5 + i;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-7 h-7 rounded text-xs ${
                      p === page ? 'bg-emerald-600 text-white font-bold'
                        : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-secondary)]'
                    }`}>{p}</button>
                );
              })}
              <button disabled={page >= totalPages} onClick={() => setPage(totalPages)}
                className="px-2 py-1 rounded text-xs text-[var(--ff-text-secondary)] disabled:opacity-30">Last</button>
            </div>
            <span className="text-xs text-[var(--ff-text-tertiary)]">
              Displaying {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
          </div>
        )}

        {/* Bottom bar — Sage-style: Save Changes | Mark Selected | Mark All */}
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
