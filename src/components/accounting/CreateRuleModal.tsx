/**
 * Create Rule Modal — opens pre-filled from a bank transaction row.
 * Extracts a recurring pattern from the description, lets user pick GL account,
 * and shows a live preview of how many transactions would match.
 */

import { useState, useEffect, useRef } from 'react';
import { X, Search, BookmarkPlus, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { BankTx, SelectOption } from './BankTxTable';
import type { RuleMatchType } from '@/modules/accounting/types/bank.types';

interface Props {
  transaction: BankTx;
  bankAccountId: string;
  glAccounts: SelectOption[];
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Strip unique references, dates, card numbers from a transaction description
 * to extract the recurring core pattern for rule matching.
 */
function extractPattern(desc: string): string {
  let p = desc;
  // Remove long hex/alphanum refs (8+ chars like "eftbbnh3gg6wp002")
  p = p.replace(/[a-f0-9]{8,}/gi, '');
  // Remove date-like patterns (2025-01-15, 15/01/2025, 20250115)
  p = p.replace(/\d{4}[-/]\d{2}[-/]\d{2}/g, '');
  p = p.replace(/\d{2}[-/]\d{2}[-/]\d{4}/g, '');
  p = p.replace(/\d{8}/g, '');
  // Remove card number fragments (4+ consecutive digits)
  p = p.replace(/\d{4,}/g, '');
  // Remove "Cmd" followed by a single letter (FNB command codes)
  p = p.replace(/\/Cmd\s+\w\b/gi, '');
  // Collapse multiple spaces and trim
  p = p.replace(/\s{2,}/g, ' ').trim();
  // Remove trailing slashes and spaces
  p = p.replace(/[/\s]+$/, '');
  return p;
}

export function CreateRuleModal({ transaction, bankAccountId, glAccounts, onClose, onCreated }: Props) {
  const [pattern, setPattern] = useState(() => extractPattern(transaction.description || ''));
  const [matchType, setMatchType] = useState<RuleMatchType>('contains');
  const [ruleName, setRuleName] = useState(() => extractPattern(transaction.description || ''));
  const [autoCreateEntry, setAutoCreateEntry] = useState(false);

  const [glSearch, setGlSearch] = useState('');
  const [selectedGl, setSelectedGl] = useState<SelectOption | null>(null);
  const [showGlDropdown, setShowGlDropdown] = useState(false);
  const glRef = useRef<HTMLDivElement>(null);

  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Close GL dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (glRef.current && !glRef.current.contains(e.target as Node)) setShowGlDropdown(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Live preview — debounced query as user edits pattern
  useEffect(() => {
    if (!pattern.trim()) { setMatchCount(0); return; }
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ pattern, matchType, bankAccountId });
        const res = await fetch(`/api/accounting/bank-rules-preview?${params}`);
        const json = await res.json();
        setMatchCount(json.data?.matchCount ?? 0);
      } catch {
        setMatchCount(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [pattern, matchType, bankAccountId]);

  const filteredGl = glSearch
    ? glAccounts.filter(a =>
        (a.code || '').toLowerCase().includes(glSearch.toLowerCase()) ||
        a.name.toLowerCase().includes(glSearch.toLowerCase())
      ).slice(0, 30)
    : glAccounts.slice(0, 30);

  const handleSave = async () => {
    if (!pattern.trim()) { toast.error('Pattern is required'); return; }
    if (!selectedGl) { toast.error('Select a GL account'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/accounting/bank-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ruleName: ruleName.trim() || pattern.trim(),
          matchField: 'description',
          matchType,
          matchPattern: pattern.trim(),
          glAccountId: selectedGl.id,
          autoCreateEntry,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.message || 'Failed to create rule');
      toast.success('Rule created');
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create rule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-xl shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center gap-2">
            <BookmarkPlus className="h-4 w-4 text-yellow-400" />
            <h2 className="text-sm font-semibold text-[var(--ff-text-primary)]">Create Categorisation Rule</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--ff-bg-primary)] text-[var(--ff-text-tertiary)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Source description */}
          <div>
            <label className="text-xs text-[var(--ff-text-tertiary)] mb-1 block">Source Description</label>
            <p className="text-xs text-[var(--ff-text-secondary)] bg-[var(--ff-bg-primary)] rounded px-3 py-2 font-mono break-all">
              {transaction.description || '—'}
            </p>
          </div>

          {/* Pattern */}
          <div>
            <label className="text-xs text-[var(--ff-text-tertiary)] mb-1 block">Match Pattern</label>
            <input
              type="text"
              value={pattern}
              onChange={e => setPattern(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-sm text-[var(--ff-text-primary)] focus:outline-none focus:border-blue-500"
            />
            {/* Match preview */}
            <div className="flex items-center gap-2 mt-1.5">
              {previewLoading ? (
                <Loader2 className="h-3 w-3 animate-spin text-[var(--ff-text-tertiary)]" />
              ) : matchCount !== null ? (
                <span className={`text-xs font-medium ${matchCount > 0 ? 'text-emerald-400' : 'text-[var(--ff-text-tertiary)]'}`}>
                  Would match <strong>{matchCount}</strong> transaction{matchCount !== 1 ? 's' : ''}
                </span>
              ) : null}
            </div>
          </div>

          {/* Match type */}
          <div>
            <label className="text-xs text-[var(--ff-text-tertiary)] mb-1 block">Match Type</label>
            <select
              value={matchType}
              onChange={e => setMatchType(e.target.value as RuleMatchType)}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-sm text-[var(--ff-text-primary)]"
            >
              <option value="contains">Contains</option>
              <option value="starts_with">Starts With</option>
              <option value="ends_with">Ends With</option>
              <option value="exact">Exact Match</option>
            </select>
          </div>

          {/* GL Account */}
          <div ref={glRef}>
            <label className="text-xs text-[var(--ff-text-tertiary)] mb-1 block">GL Account</label>
            <div className="relative">
              <button
                onClick={() => { setShowGlDropdown(!showGlDropdown); setGlSearch(''); }}
                className={`w-full text-left px-3 py-2 rounded border text-sm ${
                  selectedGl
                    ? 'bg-[var(--ff-bg-primary)] border-[var(--ff-border-light)] text-[var(--ff-text-primary)]'
                    : 'bg-[var(--ff-bg-primary)] border-amber-500/40 text-amber-400'
                }`}
              >
                {selectedGl ? `${selectedGl.code || ''} ${selectedGl.name}`.trim() : 'Select GL Account...'}
              </button>
              {showGlDropdown && (
                <div className="absolute z-50 top-full left-0 mt-1 w-full bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-xl">
                  <div className="p-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--ff-text-tertiary)]" />
                      <input
                        type="text"
                        placeholder="Search accounts..."
                        value={glSearch}
                        onChange={e => setGlSearch(e.target.value)}
                        className="w-full pl-7 pr-2 py-1.5 rounded bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-xs text-[var(--ff-text-primary)] focus:outline-none focus:border-blue-500"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredGl.map(a => (
                      <button
                        key={a.id}
                        onClick={() => { setSelectedGl(a); setShowGlDropdown(false); }}
                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--ff-bg-primary)] text-xs flex items-center gap-2"
                      >
                        {a.code && <span className="font-mono text-[var(--ff-text-tertiary)] w-10 shrink-0">{a.code}</span>}
                        <span className="text-[var(--ff-text-primary)] truncate">{a.name}</span>
                      </button>
                    ))}
                    {filteredGl.length === 0 && (
                      <div className="px-3 py-2 text-xs text-[var(--ff-text-tertiary)]">No accounts found</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Rule name */}
          <div>
            <label className="text-xs text-[var(--ff-text-tertiary)] mb-1 block">Rule Name</label>
            <input
              type="text"
              value={ruleName}
              onChange={e => setRuleName(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-sm text-[var(--ff-text-primary)] focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Auto-create toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoCreateEntry}
              onChange={e => setAutoCreateEntry(e.target.checked)}
              className="accent-emerald-500"
            />
            <span className="text-xs text-[var(--ff-text-secondary)]">
              Auto-create journal entry (otherwise suggestion only)
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--ff-border-light)]">
          <button onClick={onClose}
            className="px-4 py-1.5 rounded text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !pattern.trim() || !selectedGl}
            className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium flex items-center gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create Rule
          </button>
        </div>
      </div>
    </div>
  );
}
