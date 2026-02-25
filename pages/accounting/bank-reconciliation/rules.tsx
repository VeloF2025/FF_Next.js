/**
 * Bank Categorisation Rules Page
 * Phase 2: Quick entry rules + statement mapping
 */

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import Link from 'next/link';
import { ArrowLeft, Zap, Plus, Trash2, Loader2, ToggleLeft, ToggleRight, Play } from 'lucide-react';

interface Rule {
  id: string;
  ruleName: string;
  matchField: string;
  matchType: string;
  matchPattern: string;
  glAccountId: string;
  glAccountCode?: string;
  glAccountName?: string;
  supplierId?: string;
  supplierName?: string;
  descriptionTemplate?: string;
  priority: number;
  isActive: boolean;
  autoCreateEntry: boolean;
}

interface GLAccount { id: string; accountCode: string; accountName: string }
interface Supplier { id: string; name: string }

export default function BankRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [applyResult, setApplyResult] = useState<{ applied: number; skipped: number } | null>(null);

  const [form, setForm] = useState({
    ruleName: '', matchField: 'description', matchType: 'contains',
    matchPattern: '', glAccountId: '', supplierId: '', vatCode: '',
    descriptionTemplate: '', priority: '100',
  });

  const load = useCallback(async () => {
    const res = await fetch('/api/accounting/bank-rules', { credentials: 'include' });
    const json = await res.json();
    setRules(json.data?.items || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/accounting/chart-of-accounts', { credentials: 'include' }).then(r => r.json()).then(res => {
      const d = res.data || res;
      const list = Array.isArray(d) ? d : d.accounts || d.items || [];
      setAccounts(list.map((a: Record<string, unknown>) => ({
        id: String(a.id), accountCode: String(a.accountCode || a.account_code || ''),
        accountName: String(a.accountName || a.account_name || ''),
      })));
    });
    fetch('/api/suppliers?status=active', { credentials: 'include' }).then(r => r.json()).then(res => {
      const list = Array.isArray(res.data) ? res.data : [];
      setSuppliers(list.map((s: { id: number | string; name: string }) => ({
        id: String(s.id), name: s.name,
      })));
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy('new');
    try {
      const res = await fetch('/api/accounting/bank-rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ruleName: form.ruleName, matchField: form.matchField, matchType: form.matchType,
          matchPattern: form.matchPattern, glAccountId: form.glAccountId,
          supplierId: form.supplierId || undefined,
          descriptionTemplate: form.descriptionTemplate || undefined,
          priority: Number(form.priority) || 100,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Failed');
      setShowForm(false);
      setForm({ ruleName: '', matchField: 'description', matchType: 'contains', matchPattern: '', glAccountId: '', supplierId: '', vatCode: '', descriptionTemplate: '', priority: '100' });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setBusy(''); }
  };

  const doAction = async (action: string, id?: string, extra?: Record<string, unknown>) => {
    setBusy(id || action);
    try {
      const res = await fetch('/api/accounting/bank-rules-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ action, id, ...extra }),
      });
      const json = await res.json();
      if (action === 'apply' && json.data) setApplyResult(json.data);
      await load();
    } catch { /* ignore */ }
    setBusy('');
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] px-6 py-4">
          <Link href="/accounting/bank-reconciliation" className="inline-flex items-center gap-1 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] mb-2">
            <ArrowLeft className="h-4 w-4" /> Back to Reconciliation
          </Link>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10"><Zap className="h-6 w-6 text-yellow-500" /></div>
              <div>
                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Categorisation Rules</h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">Auto-categorise bank transactions by pattern matching</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => doAction('apply', undefined, { bankAccountId: accounts.find(a => a.accountCode === '1110')?.id })}
                disabled={!!busy} className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium disabled:opacity-50">
                {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Apply Rules
              </button>
              <button onClick={() => setShowForm(!showForm)} className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 text-sm font-medium">
                <Plus className="h-4 w-4" /> New Rule
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {error && <div className="p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">{error}</div>}
          {applyResult && (
            <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 text-sm">
              Rules applied: {applyResult.applied} categorised, {applyResult.skipped} skipped
            </div>
          )}

          {showForm && (
            <form onSubmit={handleSubmit} className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6 space-y-4">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">New Categorisation Rule</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <input value={form.ruleName} onChange={e => setForm(f => ({ ...f, ruleName: e.target.value }))} className="ff-input" placeholder="Rule Name *" required />
                <select value={form.matchField} onChange={e => setForm(f => ({ ...f, matchField: e.target.value }))} className="ff-select">
                  <option value="description">Match Description</option>
                  <option value="reference">Match Reference</option>
                  <option value="both">Match Both</option>
                </select>
                <select value={form.matchType} onChange={e => setForm(f => ({ ...f, matchType: e.target.value }))} className="ff-select">
                  <option value="contains">Contains</option>
                  <option value="starts_with">Starts With</option>
                  <option value="ends_with">Ends With</option>
                  <option value="exact">Exact Match</option>
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <input value={form.matchPattern} onChange={e => setForm(f => ({ ...f, matchPattern: e.target.value }))} className="ff-input" placeholder="Pattern (e.g. WOOLWORTHS) *" required />
                <select value={form.glAccountId} onChange={e => setForm(f => ({ ...f, glAccountId: e.target.value }))} className="ff-select" required>
                  <option value="">Select GL Account *</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>)}
                </select>
                <input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="ff-input" placeholder="Priority (lower = first)" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Quick Win 3: Supplier dropdown */}
                <select value={form.supplierId} onChange={e => setForm(f => ({ ...f, supplierId: e.target.value }))} className="ff-select">
                  <option value="">No Supplier (optional)</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {/* Quick Win 3: VAT Code select */}
                <select value={form.vatCode} onChange={e => setForm(f => ({ ...f, vatCode: e.target.value }))} className="ff-select">
                  <option value="">No VAT</option>
                  <option value="standard">Standard 15%</option>
                  <option value="zero_rated">Zero Rated</option>
                  <option value="exempt">Exempt</option>
                </select>
                <input value={form.descriptionTemplate} onChange={e => setForm(f => ({ ...f, descriptionTemplate: e.target.value }))} className="ff-input" placeholder="Description template (optional)" />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-[var(--ff-text-secondary)]">Cancel</button>
                <button type="submit" disabled={busy === 'new'} className="px-6 py-2 bg-yellow-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {busy === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create Rule'}
                </button>
              </div>
            </form>
          )}

          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--ff-border-light)] text-left text-[var(--ff-text-secondary)]">
                <th className="px-4 py-3">Rule</th>
                <th className="px-4 py-3">Match</th>
                <th className="px-4 py-3">Pattern</th>
                <th className="px-4 py-3">GL Account</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--ff-text-tertiary)]">Loading...</td></tr>}
                {!loading && rules.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--ff-text-tertiary)]">No rules configured. Create one to auto-categorise bank transactions.</td></tr>}
                {rules.map(rule => (
                  <tr key={rule.id} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-primary)]/50">
                    <td className="px-4 py-3 text-[var(--ff-text-primary)] font-medium">{rule.ruleName}</td>
                    <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                      <span className="text-xs">{rule.matchField} {rule.matchType}</span>
                    </td>
                    <td className="px-4 py-3"><code className="px-2 py-0.5 rounded bg-[var(--ff-bg-primary)] text-yellow-400 text-xs">{rule.matchPattern}</code></td>
                    <td className="px-4 py-3 text-[var(--ff-text-secondary)] text-xs">
                      {rule.glAccountCode} — {rule.glAccountName}
                    </td>
                    <td className="px-4 py-3 text-[var(--ff-text-secondary)] text-xs">
                      {rule.supplierName || <span className="text-[var(--ff-text-tertiary)]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[var(--ff-text-secondary)]">{rule.priority}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${rule.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-500/10 text-gray-400'}`}>
                        {rule.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => doAction('toggle', rule.id, { isActive: !rule.isActive })} disabled={busy === rule.id} className="p-1 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]" title={rule.isActive ? 'Disable' : 'Enable'}>
                          {rule.isActive ? <ToggleRight className="h-4 w-4 text-emerald-400" /> : <ToggleLeft className="h-4 w-4" />}
                        </button>
                        <button onClick={() => doAction('delete', rule.id)} disabled={busy === rule.id} className="p-1 text-red-400 hover:text-red-300" title="Delete">
                          {busy === rule.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
