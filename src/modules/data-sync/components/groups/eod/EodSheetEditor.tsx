'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { EodInstallSheet, EodInstallSheetEntry, EodMatchStatus } from '../../../types';

const STATUS_CONFIG: Record<EodMatchStatus, { label: string; color: string; bg: string }> = {
  matched_all:  { label: 'Full Match',    color: 'text-green-400', bg: 'bg-green-500/10' },
  partial_match:{ label: 'Partial',       color: 'text-amber-400', bg: 'bg-amber-500/10' },
  not_activated:{ label: 'Not Activated', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  missing_wa:   { label: 'No WA DR',      color: 'text-red-400',   bg: 'bg-red-500/10' },
  missing_eod:  { label: 'No EOD Entry',  color: 'text-red-400',   bg: 'bg-red-500/10' },
  pending:      { label: 'Pending',       color: 'text-gray-400',  bg: 'bg-gray-500/10' },
};

const EDITABLE_FIELDS: Array<{ key: keyof EodInstallSheetEntry; label: string; width: string }> = [
  { key: 'dr_number',    label: 'DR',      width: 'w-20' },
  { key: 'ont_serial',   label: 'ONT',     width: 'w-28' },
  { key: 'gizzu_serial', label: 'Gizzu',   width: 'w-28' },
  { key: 'pon_number',   label: 'PON',     width: 'w-16' },
  { key: 'address',      label: 'Address', width: 'w-40' },
];

interface SaveResult {
  updated_count: number;
  matched_count: number;
  logged_count: number;
}

interface Props {
  sheet: EodInstallSheet;
  onClose: () => void;
}

export function EodSheetEditor({ sheet, onClose }: Props) {
  const [entries, setEntries] = useState<EodInstallSheetEntry[]>(sheet.entries ?? []);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateField = (id: string, field: keyof EodInstallSheetEntry, value: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, [field]: value || null } : e))
    );
    setResult(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/eod/sheets/${sheet.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: entries.map((e) => ({
            id: e.id,
            row_number: e.row_number,
            ont_serial: e.ont_serial,
            gizzu_serial: e.gizzu_serial,
            dr_number: e.dr_number,
            pon_number: e.pon_number,
            address: e.address,
          })),
        }),
      });
      const json = (await res.json()) as { success: boolean; data?: SaveResult; error?: string };
      if (json.success && json.data) {
        setResult(json.data);
      } else {
        setError(json.error ?? 'Save failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-[var(--ff-text-secondary)]">
        Tech ID: {sheet.technician_id || 'N/A'} · Sheet ID: {sheet.id}
      </div>

      {result && (
        <div className="text-xs text-green-400 bg-green-500/10 px-3 py-2 rounded">
          Saved — {result.updated_count} entries updated
          {result.matched_count > 0 && `, ${result.matched_count} serial(s) written back`}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded">{error}</div>
      )}

      {entries.length === 0 ? (
        <p className="text-xs text-[var(--ff-text-tertiary)]">No entries in this sheet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--ff-border-light)]">
                <th className="text-left px-2 py-1 text-[var(--ff-text-tertiary)] font-medium w-8">#</th>
                {EDITABLE_FIELDS.map((f) => (
                  <th key={f.key} className="text-left px-2 py-1 text-[var(--ff-text-tertiary)] font-medium">
                    {f.label}
                  </th>
                ))}
                <th className="text-left px-2 py-1 text-[var(--ff-text-tertiary)] font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const cfg = STATUS_CONFIG[entry.match_status] ?? STATUS_CONFIG.pending;
                return (
                  <tr key={entry.id} className="border-b border-[var(--ff-border-light)]">
                    <td className="px-2 py-1 text-[var(--ff-text-tertiary)]">{entry.row_number}</td>
                    {EDITABLE_FIELDS.map((f) => (
                      <td key={f.key} className="px-1 py-1">
                        <input
                          type="text"
                          value={(entry[f.key] as string | null) ?? ''}
                          onChange={(ev) => updateField(entry.id, f.key, ev.target.value)}
                          className={`${f.width} bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded px-2 py-0.5 text-[var(--ff-text-primary)] font-mono focus:outline-none focus:border-[var(--ff-accent)]`}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1">
                      <span className={`px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
        {entries.length > 0 && (
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        )}
      </div>
    </div>
  );
}
