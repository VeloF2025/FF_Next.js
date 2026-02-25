/**
 * Sage-style bank transaction table with inline allocation
 * Type selector: Account / Supplier / Customer — Selection dropdown changes accordingly
 */

import { useState, useRef, useEffect } from 'react';
import { Check, X, Undo2, Search } from 'lucide-react';

export type AllocType = 'account' | 'supplier' | 'customer';

export interface BankTx {
  id: string;
  transactionDate: string;
  description?: string;
  reference?: string;
  bankReference?: string;
  amount: number;
  status: string;
}

export interface SelectOption {
  id: string;
  code?: string;
  name: string;
}

export interface RowSelection {
  type: AllocType;
  entityId: string;
  label: string;
}

interface Props {
  transactions: BankTx[];
  glAccounts: SelectOption[];
  suppliers: SelectOption[];
  customers: SelectOption[];
  selectedIds: Set<string>;
  rowSelections: Record<string, RowSelection>;
  allSelected: boolean;
  tab: 'new' | 'reviewed';
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onRowTypeChange: (txId: string, type: AllocType) => void;
  onRowEntityChange: (txId: string, entityId: string, label: string) => void;
  onAccept: (txId: string) => void;
  onExclude: (txId: string) => void;
  onUnmatch: (txId: string) => void;
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(n);
}

export function BankTxTable(props: Props) {
  const {
    transactions, glAccounts, suppliers, customers,
    selectedIds, rowSelections, allSelected, tab,
    onToggleSelect, onSelectAll, onRowTypeChange, onRowEntityChange,
    onAccept, onExclude, onUnmatch,
  } = props;
  const [openSel, setOpenSel] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenSel(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  function getOptionsForType(type: AllocType): SelectOption[] {
    if (type === 'supplier') return suppliers;
    if (type === 'customer') return customers;
    return glAccounts;
  }

  function filterOptions(options: SelectOption[], q: string): SelectOption[] {
    if (!q) return options.slice(0, 30);
    const lq = q.toLowerCase();
    return options.filter(o =>
      (o.code || '').toLowerCase().includes(lq) ||
      o.name.toLowerCase().includes(lq)
    ).slice(0, 30);
  }

  const TH = 'py-2 px-2 font-medium text-left';

  return (
    <div className="overflow-x-auto" ref={ref}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--ff-border-light)] text-[var(--ff-text-tertiary)] text-xs">
            <th className="py-2 px-2 w-8">
              <input type="checkbox" checked={allSelected} onChange={onSelectAll} className="accent-emerald-500" />
            </th>
            <th className={`${TH} w-24`}>Date</th>
            <th className={`${TH} w-20`}>Payee</th>
            <th className={TH}>Description</th>
            <th className={`${TH} w-24`}>Type</th>
            <th className={`${TH} w-52`}>Selection</th>
            <th className={`${TH} w-28`}>Reference</th>
            <th className={`${TH} w-16`}>VAT</th>
            <th className="py-2 px-2 font-medium text-right w-24">Spent</th>
            <th className="py-2 px-2 font-medium text-right w-24">Received</th>
            <th className="py-2 px-2 font-medium text-center w-16">Actions</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map(tx => {
            const isNew = tx.status === 'imported';
            const sel = rowSelections[tx.id];
            const rowType: AllocType = sel?.type || 'account';
            const isOpen = openSel === tx.id;
            const spent = tx.amount < 0 ? Math.abs(tx.amount) : null;
            const received = tx.amount > 0 ? tx.amount : null;
            const options = filterOptions(getOptionsForType(rowType), isOpen ? search : '');

            return (
              <tr key={tx.id} className={`border-b border-[var(--ff-border-light)]/50 hover:bg-[var(--ff-bg-secondary)]/50 ${
                isOpen ? 'bg-blue-500/5' : ''
              }`}>
                <td className="py-2 px-2">
                  <input type="checkbox" checked={selectedIds.has(tx.id)}
                    onChange={() => onToggleSelect(tx.id)} className="accent-emerald-500" />
                </td>
                <td className="py-2 px-2 font-mono text-xs text-[var(--ff-text-secondary)]">
                  {tx.transactionDate}
                </td>
                <td className="py-2 px-2 text-xs text-[var(--ff-text-tertiary)]">—</td>
                <td className="py-2 px-2 text-[var(--ff-text-primary)]">
                  <span className="line-clamp-1 text-xs">{tx.description || '—'}</span>
                </td>
                {/* Type dropdown — Account / Supplier / Customer */}
                <td className="py-2 px-2">
                  {isNew ? (
                    <select
                      value={rowType}
                      onChange={e => onRowTypeChange(tx.id, e.target.value as AllocType)}
                      className="text-xs px-1 py-0.5 rounded bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] w-full"
                    >
                      <option value="account">Account</option>
                      <option value="supplier">Supplier</option>
                      <option value="customer">Customer</option>
                    </select>
                  ) : (
                    <span className="text-xs text-[var(--ff-text-secondary)]">
                      {sel?.type === 'supplier' ? 'Supplier' : sel?.type === 'customer' ? 'Customer' : 'Account'}
                    </span>
                  )}
                </td>
                {/* Selection — GL account / Supplier / Customer selector */}
                <td className="py-2 px-2 relative">
                  {isNew ? (
                    <>
                      <button
                        onClick={() => { setOpenSel(isOpen ? null : tx.id); setSearch(''); }}
                        className={`text-xs px-2 py-0.5 rounded truncate max-w-[200px] block ${
                          sel?.entityId
                            ? 'text-[var(--ff-text-primary)] bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)]'
                            : rowType === 'account'
                              ? 'text-amber-400 bg-amber-500/10 font-medium'
                              : rowType === 'supplier'
                                ? 'text-blue-400 bg-blue-500/10 font-medium'
                                : 'text-purple-400 bg-purple-500/10 font-medium'
                        }`}
                      >
                        {sel?.entityId ? sel.label : (
                          rowType === 'supplier' ? 'Select Supplier'
                          : rowType === 'customer' ? 'Select Customer'
                          : 'Unallocated'
                        )}
                      </button>
                      {isOpen && (
                        <div className="absolute z-50 top-full left-0 mt-1 w-80 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-xl">
                          <div className="p-2">
                            <div className="relative">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--ff-text-tertiary)]" />
                              <input type="text"
                                placeholder={`Search ${rowType === 'supplier' ? 'suppliers' : rowType === 'customer' ? 'customers' : 'accounts'}...`}
                                value={search} onChange={e => setSearch(e.target.value)}
                                className="w-full pl-7 pr-2 py-1.5 rounded bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-xs text-[var(--ff-text-primary)] focus:outline-none focus:border-blue-500"
                                autoFocus />
                            </div>
                          </div>
                          <div className="max-h-48 overflow-y-auto">
                            {options.map(o => (
                              <button key={o.id}
                                onClick={() => {
                                  onRowEntityChange(tx.id, o.id, o.code ? `${o.code} ${o.name}` : o.name);
                                  setOpenSel(null);
                                }}
                                className="w-full text-left px-3 py-1.5 hover:bg-[var(--ff-bg-primary)] text-xs flex items-center gap-2"
                              >
                                {o.code && <span className="font-mono text-[var(--ff-text-tertiary)] w-10 shrink-0">{o.code}</span>}
                                <span className="text-[var(--ff-text-primary)] truncate">{o.name}</span>
                              </button>
                            ))}
                            {options.length === 0 && (
                              <div className="px-3 py-2 text-xs text-[var(--ff-text-tertiary)]">No results found</div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-emerald-400">{sel?.label || 'Allocated'}</span>
                  )}
                </td>
                <td className="py-2 px-2 text-xs font-mono text-[var(--ff-text-tertiary)]">
                  {tx.reference || tx.bankReference || ''}
                </td>
                <td className="py-2 px-2 text-xs text-[var(--ff-text-tertiary)]">No VAT</td>
                <td className="py-2 px-2 text-right font-mono text-xs text-red-400">
                  {spent !== null ? fmtCurrency(spent) : ''}
                </td>
                <td className="py-2 px-2 text-right font-mono text-xs text-emerald-400">
                  {received !== null ? fmtCurrency(received) : ''}
                </td>
                <td className="py-2 px-2 text-center">
                  <div className="flex items-center gap-0.5 justify-center">
                    {isNew ? (
                      <>
                        <button onClick={() => onAccept(tx.id)} disabled={!sel?.entityId} title="Accept"
                          className="p-1 rounded hover:bg-emerald-500/10 text-emerald-400 disabled:opacity-30">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => onExclude(tx.id)} title="Exclude"
                          className="p-1 rounded hover:bg-red-500/10 text-red-400">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <button onClick={() => onUnmatch(tx.id)} title="Undo allocation"
                        className="p-1 rounded hover:bg-amber-500/10 text-amber-400">
                        <Undo2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
