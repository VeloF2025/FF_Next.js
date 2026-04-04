/**
 * EOD Reconciliation Tab
 * 3-way reconciliation grid: EOD Sheet ↔ WA DRs ↔ OES Activations
 */

'use client';

import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Calendar } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { EodReconciliationRow, EodReconciliationSummary } from '../../../types';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  matched_all:   { label: 'Full Match',     color: 'text-green-400',  bg: 'bg-green-500/10' },
  not_activated:  { label: 'Not Activated',  color: 'text-amber-400',  bg: 'bg-amber-500/10' },
  missing_wa:     { label: 'No WA DR',       color: 'text-red-400',    bg: 'bg-red-500/10' },
  missing_eod:    { label: 'No EOD Entry',   color: 'text-red-400',    bg: 'bg-red-500/10' },
  partial_match:  { label: 'Partial Match',  color: 'text-amber-400',  bg: 'bg-amber-500/10' },
  pending:        { label: 'Pending',        color: 'text-gray-400',   bg: 'bg-gray-500/10' },
};

export function EodReconciliationTab() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const [date, setDate] = useState(yesterday.toISOString().split('T')[0]);
  const [rows, setRows] = useState<EodReconciliationRow[]>([]);
  const [summary, setSummary] = useState<EodReconciliationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReconciliation = async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/eod/reconciliation?date=${d}`);
      const json = await res.json();
      if (!json.success) {
        setError(json.message || 'Failed to load');
        return;
      }
      setRows(json.data.rows);
      setSummary(json.data.summary);
    } catch {
      setError('Failed to fetch reconciliation data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (date) fetchReconciliation(date);
  }, [date]);

  return (
    <div className="space-y-6">
      {/* Date Picker */}
      <div className="flex items-center gap-4">
        <Calendar className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded px-3 py-2 text-sm text-[var(--ff-text-primary)] focus:outline-none focus:border-[var(--ff-accent)]"
        />
        <span className="text-xs text-[var(--ff-text-tertiary)]">
          OES activations compared from {date ? new Date(new Date(date).getTime() + 86400000).toISOString().split('T')[0] : '—'}
        </span>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <SummaryCard label="EOD Entries" value={summary.total_eod} color="text-teal-400" />
          <SummaryCard label="Matched WA" value={summary.matched_wa} color="text-blue-400" />
          <SummaryCard label="Matched OES" value={summary.matched_oes} color="text-purple-400" />
          <SummaryCard label="Full Match" value={summary.matched_all} color="text-green-400" />
          <SummaryCard label="Discrepancies" value={summary.discrepancies} color="text-red-400" />
        </div>
      )}

      {/* Loading / Error */}
      {loading && <LoadingSpinner className="py-12" size="lg" label="" />}

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Reconciliation Grid */}
      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--ff-border-light)]">
                <th className="text-left px-3 py-2 text-[var(--ff-text-secondary)] font-medium">DR Number</th>
                <th className="text-left px-3 py-2 text-[var(--ff-text-secondary)] font-medium">ONT Serial</th>
                <th className="text-center px-3 py-2 text-[var(--ff-text-secondary)] font-medium">EOD</th>
                <th className="text-center px-3 py-2 text-[var(--ff-text-secondary)] font-medium">WA DR</th>
                <th className="text-center px-3 py-2 text-[var(--ff-text-secondary)] font-medium">OES</th>
                <th className="text-left px-3 py-2 text-[var(--ff-text-secondary)] font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const cfg = STATUS_CONFIG[row.match_status] || STATUS_CONFIG.pending;
                return (
                  <tr key={i} className={`border-b border-[var(--ff-border-light)] ${cfg.bg}`}>
                    <td className="px-3 py-2 text-[var(--ff-text-primary)] font-mono text-xs">
                      {row.dr_number || '—'}
                    </td>
                    <td className="px-3 py-2 text-[var(--ff-text-primary)] font-mono text-xs">
                      {row.ont_serial || '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {row.eod_entry_id ? (
                        <CheckCircle className="w-4 h-4 text-green-400 mx-auto" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400 mx-auto" />
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {row.wa_dr_id ? (
                        <CheckCircle className="w-4 h-4 text-green-400 mx-auto" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400 mx-auto" />
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {row.oes_id ? (
                        <CheckCircle className="w-4 h-4 text-green-400 mx-auto" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-400 mx-auto" />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && rows.length === 0 && (
        <div className="text-center py-12 text-[var(--ff-text-secondary)]">
          No EOD sheets or DR data found for {date}. Upload an EOD sheet first.
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
      <p className="text-xs text-[var(--ff-text-secondary)]">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
