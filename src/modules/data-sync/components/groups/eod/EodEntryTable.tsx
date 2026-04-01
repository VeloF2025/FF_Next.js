/**
 * EOD Entry Table
 * Editable/read-only table for EOD install sheet entries
 */

'use client';

import React from 'react';
import type { EodVlmEntry } from '../../../types';

interface EodEntryTableProps {
  entries: EodVlmEntry[];
  editable?: boolean;
  onChange?: (entries: EodVlmEntry[]) => void;
}

export function EodEntryTable({ entries, editable = false, onChange }: EodEntryTableProps) {
  const updateEntry = (index: number, field: keyof EodVlmEntry, value: string) => {
    if (!onChange) return;
    const updated = entries.map((e, i) =>
      i === index ? { ...e, [field]: value || null } : e
    );
    onChange(updated);
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
            <th className="text-left px-2 py-2 text-[var(--ff-text-secondary)] font-medium">ONT Serial</th>
            <th className="text-left px-2 py-2 text-[var(--ff-text-secondary)] font-medium">Gizzu Serial</th>
            <th className="text-left px-2 py-2 text-[var(--ff-text-secondary)] font-medium w-20">PON</th>
            <th className="text-left px-2 py-2 text-[var(--ff-text-secondary)] font-medium">Address</th>
            {!editable && (
              <th className="text-left px-2 py-2 text-[var(--ff-text-secondary)] font-medium w-16">Conf</th>
            )}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => {
            const rowBg = entry.confidence < 0.7 ? 'bg-amber-500/5' : '';
            return (
              <tr key={i} className={`border-b border-[var(--ff-border-light)] ${rowBg}`}>
                <td className="px-2 py-1.5 text-[var(--ff-text-tertiary)]">{entry.row_number}</td>
                <td className="px-2 py-1.5">
                  {editable ? (
                    <input className={cellClass} value={entry.dr_number || ''} onChange={(e) => updateEntry(i, 'dr_number', e.target.value)} placeholder="DR..." />
                  ) : (
                    <span className={cellClass}>{entry.dr_number || '\u2014'}</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {editable ? (
                    <input className={cellClass} value={entry.ont_serial || ''} onChange={(e) => updateEntry(i, 'ont_serial', e.target.value)} placeholder="ALCL..." />
                  ) : (
                    <span className={`${cellClass} font-mono text-xs`}>{entry.ont_serial || '\u2014'}</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {editable ? (
                    <input className={cellClass} value={entry.gizzu_serial || ''} onChange={(e) => updateEntry(i, 'gizzu_serial', e.target.value)} placeholder="GU..." />
                  ) : (
                    <span className={`${cellClass} font-mono text-xs`}>{entry.gizzu_serial || '\u2014'}</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {editable ? (
                    <input className={cellClass} value={entry.pon_number || ''} onChange={(e) => updateEntry(i, 'pon_number', e.target.value)} placeholder="128" />
                  ) : (
                    <span className={cellClass}>{entry.pon_number || '\u2014'}</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {editable ? (
                    <input className={cellClass} value={entry.address || ''} onChange={(e) => updateEntry(i, 'address', e.target.value)} placeholder="Address" />
                  ) : (
                    <span className={cellClass}>{entry.address || '\u2014'}</span>
                  )}
                </td>
                {!editable && (
                  <td className="px-2 py-1.5">
                    <span className={`text-xs font-medium ${entry.confidence >= 0.8 ? 'text-green-400' : entry.confidence >= 0.7 ? 'text-amber-400' : 'text-red-400'}`}>
                      {Math.round(entry.confidence * 100)}%
                    </span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
