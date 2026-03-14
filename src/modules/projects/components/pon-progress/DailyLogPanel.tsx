/**
 * Daily Log Panel (Storyline)
 * Shows timeline of daily entries for a PON and allows adding new entries.
 * Replaces Johan's daily date columns from the Optical Tracker spreadsheet.
 */

import { useState, useEffect, useCallback } from 'react';
import type { PonDailyLogEntry, ProgressCategory, DelayReason } from '@/types/pon-stages.types';
import { DELAY_REASON_LABELS } from '@/types/pon-stages.types';

interface DailyLogPanelProps {
  projectId: string;
  ponStageId: string;
  ponLabel: string;
  onClose: () => void;
}

const CATEGORY_COLORS: Record<ProgressCategory, string> = {
  cwc: '#F59E0B',
  optical: '#10B981',
  activation: '#3B82F6',
  maintenance: '#F97316',
};

const CATEGORY_LABELS: Record<ProgressCategory, string> = {
  cwc: 'CWC',
  optical: 'Optical',
  activation: 'Activation',
  maintenance: 'Maint.',
};

const CATEGORIES: ProgressCategory[] = ['cwc', 'optical', 'activation', 'maintenance'];

const DELAY_REASONS: DelayReason[] = [
  'rain', 'smme_issues', 'stock_issues', 'site_stopped',
  'access_issues', 'power_issues', 'permit_delay', 'equipment_failure', 'other',
];

export function DailyLogPanel({ projectId, ponStageId, ponLabel, onClose }: DailyLogPanelProps) {
  const [entries, setEntries] = useState<PonDailyLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<ProgressCategory | 'all'>('all');
  const [saving, setSaving] = useState(false);

  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]!);
  const [newCategory, setNewCategory] = useState<ProgressCategory>('optical');
  const [newActivity, setNewActivity] = useState('');
  const [newDelay, setNewDelay] = useState<DelayReason | ''>('');

  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      const catParam = filterCategory !== 'all' ? `&category=${filterCategory}` : '';
      const res = await fetch(
        `/api/projects/${projectId}/pon-daily-log?pon_stage_id=${ponStageId}${catParam}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, [projectId, ponStageId, filterCategory]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleAddEntry = async () => {
    if (!newActivity.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/pon-progress`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pon_stage_id: ponStageId,
          action: 'add_daily_log',
          daily_log: {
            date: newDate,
            category: newCategory,
            activity: newActivity.trim(),
            delay_reason: newDelay || null,
          },
        }),
      });
      if (res.ok) {
        setNewActivity('');
        setNewDelay('');
        fetchEntries();
      }
    } catch {
      // Silent fail
    } finally {
      setSaving(false);
    }
  };

  // Group entries by date
  const grouped = new Map<string, PonDailyLogEntry[]>();
  for (const entry of entries) {
    const existing = grouped.get(entry.log_date) || [];
    existing.push(entry);
    grouped.set(entry.log_date, existing);
  }

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-[var(--ff-card-bg)] border-l border-[var(--ff-border-light)] shadow-2xl z-50 flex flex-col animate-slide-in">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--ff-border-light)] flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-semibold text-[var(--ff-text-primary)]">Daily Log</h3>
            <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5">{ponLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-secondary)] transition-colors"
            aria-label="Close panel"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Add Entry Form */}
        <div className="px-5 py-4 border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] shrink-0">
          <p className="text-xs font-medium text-[var(--ff-text-secondary)] mb-2 uppercase tracking-wide">New Entry</p>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="flex-1 px-3 py-2 text-sm bg-[var(--ff-card-bg)] border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-primary)]"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as ProgressCategory)}
                className="w-32 px-3 py-2 text-sm bg-[var(--ff-card-bg)] border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-primary)]"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <textarea
              value={newActivity}
              onChange={(e) => setNewActivity(e.target.value)}
              placeholder="What happened? (e.g. Prep and splice, Submit, Live...)"
              rows={2}
              className="w-full px-3 py-2 text-sm bg-[var(--ff-card-bg)] border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-secondary)] resize-none"
            />
            <div className="flex gap-2">
              <select
                value={newDelay}
                onChange={(e) => setNewDelay(e.target.value as DelayReason | '')}
                className="flex-1 px-3 py-2 text-sm bg-[var(--ff-card-bg)] border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-primary)]"
              >
                <option value="">No delay reason</option>
                {DELAY_REASONS.map((r) => (
                  <option key={r} value={r}>{DELAY_REASON_LABELS[r]}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddEntry}
                disabled={saving || !newActivity.trim()}
                className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="px-5 py-2 border-b border-[var(--ff-border-light)] flex gap-1 shrink-0 overflow-x-auto">
          {(['all', ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setFilterCategory(c)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                filterCategory === c
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              {c === 'all' ? 'All' : CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-500" />
            </div>
          ) : grouped.size === 0 ? (
            <div className="text-center py-12">
              <svg className="w-10 h-10 mx-auto mb-3 text-[var(--ff-text-secondary)] opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
              </svg>
              <p className="text-sm text-[var(--ff-text-secondary)]">No entries yet</p>
              <p className="text-xs text-[var(--ff-text-secondary)] mt-1">Add an entry above to start the timeline</p>
            </div>
          ) : (
            Array.from(grouped.entries()).map(([date, dateEntries]) => (
              <div key={date}>
                <div className="text-xs font-semibold text-[var(--ff-text-secondary)] mb-2 uppercase tracking-wide">
                  {new Date(date + 'T00:00:00').toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                <div className="space-y-2">
                  {dateEntries.map((entry) => (
                    <div key={entry.id} className="flex gap-3 p-3 bg-[var(--ff-bg-secondary)] rounded-lg">
                      <div
                        className="w-1 rounded-full flex-shrink-0 self-stretch"
                        style={{ backgroundColor: CATEGORY_COLORS[entry.category] }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="text-xs font-medium px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: `${CATEGORY_COLORS[entry.category]}20`,
                              color: CATEGORY_COLORS[entry.category],
                            }}
                          >
                            {CATEGORY_LABELS[entry.category]}
                          </span>
                          {entry.delay_reason && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                              {DELAY_REASON_LABELS[entry.delay_reason as DelayReason]}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-[var(--ff-text-primary)] leading-relaxed">{entry.activity}</p>
                        {entry.logged_by && (
                          <p className="text-xs text-[var(--ff-text-secondary)] mt-1">by {entry.logged_by}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
