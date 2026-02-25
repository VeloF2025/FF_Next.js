/**
 * Bank Accounts Management
 * Sage equivalent: Banking > Bank Accounts
 * View and manage bank accounts linked to GL
 */

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Landmark, Loader2, AlertCircle, Plus, ArrowUpRight, ArrowDownRight } from 'lucide-react';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);
}

interface BankAccount {
  id: string;
  accountCode: string;
  accountName: string;
  description?: string;
  isActive: boolean;
  txnCount: number;
  totalDebits: number;
  totalCredits: number;
  balance: number;
  firstDate?: string;
  lastDate?: string;
}

export default function BankAccountsPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAccounts = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/accounting/bank-accounts');
      const json = await res.json();
      const data = json.data || json;
      setAccounts(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed to load bank accounts');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-cyan-500/10">
                  <Landmark className="h-6 w-6 text-cyan-500" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Bank Accounts</h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Manage bank accounts and view balances
                  </p>
                </div>
              </div>
              <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-2 text-sm">
                <Plus className="h-4 w-4" />
                Add Bank Account
              </button>
            </div>
          </div>
        </div>

        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-red-400 py-8 justify-center">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-12">
              <Landmark className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
              <p className="text-[var(--ff-text-secondary)]">No bank accounts configured</p>
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                Bank accounts are GL accounts with subtype &quot;bank&quot;
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {accounts.map((acct) => (
                <div key={acct.id} className="p-5 rounded-xl bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] hover:border-cyan-500/30 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-mono text-[var(--ff-text-tertiary)]">{acct.accountCode}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${acct.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                      {acct.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">{acct.accountName}</h3>
                  {acct.description && (
                    <p className="text-sm text-[var(--ff-text-secondary)] mt-1">{acct.description}</p>
                  )}

                  <div className="mt-4 pt-3 border-t border-[var(--ff-border-light)]">
                    <p className="text-sm text-[var(--ff-text-secondary)]">Net Balance</p>
                    <p className={`text-2xl font-bold ${acct.balance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatCurrency(acct.balance)}
                    </p>
                  </div>

                  <div className="mt-3 flex gap-4 text-sm">
                    <div className="flex items-center gap-1 text-emerald-400">
                      <ArrowDownRight className="h-3.5 w-3.5" />
                      <span>{formatCurrency(acct.totalCredits)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-red-400">
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      <span>{formatCurrency(acct.totalDebits)}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-[var(--ff-text-tertiary)]">
                    <span>{acct.txnCount.toLocaleString()} transactions</span>
                    {acct.firstDate && acct.lastDate && (
                      <span>{acct.firstDate} → {acct.lastDate}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
