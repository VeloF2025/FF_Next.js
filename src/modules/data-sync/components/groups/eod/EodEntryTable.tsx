/**
 * EOD Entry Table
 * Editable/read-only table with per-row barcode scan for ONT serials
 */

'use client';

import React, { useRef, useState } from 'react';
import { ScanLine, Loader2 } from 'lucide-react';
import type { EodVlmEntry } from '../../../types';

interface EodEntryTableProps {
  entries: EodVlmEntry[];
  editable?: boolean;
  onChange?: (entries: EodVlmEntry[]) => void;
}

export function EodEntryTable({ entries, editable = false, onChange }: EodEntryTableProps) {
  const [scanningRow, setScanningRow] = useState<number | null>(null);
  const scanInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  const updateEntry = (index: number, field: keyof EodVlmEntry, value: string) => {
    if (!onChange) return;
    const updated = entries.map((e, i) =>
      i === index ? { ...e, [field]: value || null } : e
    );
    onChange(updated);
  };

  const handleScanCapture = async (index: number, file: File) => {
    setScanningRow(index);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch('/api/eod/scan-barcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 }),
      });
      const json = await res.json();
      if (json.success && json.data?.serial) {
        updateEntry(index, 'ont_serial', json.data.serial);
      }
    } catch {
      // silently fail — user can type manually
    } finally {
      setScanningRow(null);
    }
  };

  const triggerScan = (index: number) => {
    const input = scanInputRefs.current.get(index);
    if (input) input.click();
  };

  const cellClass = editable
    ? 'bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded px-2 py-1 text-sm text-[var(--ff-text-primary)] w-full focus:outline-none focus:border-[var(--ff-accent)]'
    : 'text-sm text-[var(--ff-text-primary)] px-2 py-1';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--ff-border-light)]">
            <th className="text-left px-2 py-2 text-[var(--ff-text-secondary)] font-medium w-10">#</th>
            <th className="text-left px-2 py-2 text-[var(--ff-text-secondary)] font-medium">DR Number</th>
            <th className="text-left px-2 py-2 text-[var(--ff-text-secondary)] font-medium">
              ONT Serial {editable && <span className="text-xs text-[var(--ff-text-tertiary)]">(scan sticker)</span>}
            </th>
            <th className="text-left px-2 py-2 text-[var(--ff-text-secondary)] font-medium">Gizzu Serial</th>
            <th className="text-left px-2 py-2 text-[var(--ff-text-secondary)] font-medium w-20">PON</th>
            <th className="text-left px-2 py-2 text-[var(--ff-text-secondary)] font-medium">Address</th>
            {!editable && (
              <th className="text-left px-2 py-2 text-[var(--ff-text-secondary)] font-medium w-16">Conf</th>
            )}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => (
            <tr
              key={i}
              className={`border-b border-[var(--ff-border-light)] ${
                entry.confidence < 0.7 ? 'bg-amber-500/5' : ''
              }`}
            >
              <td className="px-2 py-1.5 text-[var(--ff-text-tertiary)]">{entry.row_number}</td>
              <td className="px-2 py-1.5">
                {editable ? (
                  <input
                    className={cellClass}
                    value={entry.dr_number || ''}
                    onChange={(e) => updateEntry(i, 'dr_number', e.target.value)}
                    placeholder="DR..."
                  />
                ) : (
                  <span className={cellClass}>{entry.dr_number || '—'}</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                {editable ? (
                  <div className="flex gap-1 items-center">
                    <input
                      className={cellClass}
                      value={entry.ont_serial || ''}
                      onChange={(e) => updateEntry(i, 'ont_serial', e.target.value)}
                      placeholder="ALCL..."
                    />
                    <input
                      ref={(el) => { if (el) scanInputRefs.current.set(i, el); }}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleScanCapture(i, f);
                        e.target.value = '';
                      }}
                    />
                    <button
                      onClick={() => triggerScan(i)}
                      disabled={scanningRow !== null}
                      className="flex-shrink-0 p-1.5 rounded bg-[var(--ff-accent)]/10 text-[var(--ff-accent)] hover:bg-[var(--ff-accent)]/20 transition-colors disabled:opacity-50"
                      title="Scan barcode sticker"
                    >
                      {scanningRow === i ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ScanLine className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                ) : (
                  <span className={`${cellClass} font-mono text-xs`}>{entry.ont_serial || '—'}</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                {editable ? (
                  <input
                    className={cellClass}
                    value={entry.gizzu_serial || ''}
                    onChange={(e) => updateEntry(i, 'gizzu_serial', e.target.value)}
                    placeholder="GU..."
                  />
                ) : (
                  <span className={`${cellClass} font-mono text-xs`}>{entry.gizzu_serial || '—'}</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                {editable ? (
                  <input
                    className={cellClass}
                    value={entry.pon_number || ''}
                    onChange={(e) => updateEntry(i, 'pon_number', e.target.value)}
                    placeholder="128"
                  />
                ) : (
                  <span className={cellClass}>{entry.pon_number || '—'}</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                {editable ? (
                  <input
                    className={cellClass}
                    value={entry.address || ''}
                    onChange={(e) => updateEntry(i, 'address', e.target.value)}
                    placeholder="Address"
                  />
                ) : (
                  <span className={cellClass}>{entry.address || '—'}</span>
                )}
              </td>
              {!editable && (
                <td className="px-2 py-1.5">
                  <span
                    className={`text-xs font-medium ${
                      entry.confidence >= 0.8
                        ? 'text-green-400'
                        : entry.confidence >= 0.7
                        ? 'text-amber-400'
                        : 'text-red-400'
                    }`}
                  >
                    {Math.round(entry.confidence * 100)}%
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
