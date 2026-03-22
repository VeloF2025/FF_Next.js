/**
 * conduit-cells — Shared cell components for Conduit tables.
 * EditableCell: white bg, inline number/percent editor.
 * ReadCell: dark bg, colour-coded calculated values.
 */
'use client';

import { useState, useRef } from 'react';

// ─── Formatters ─────────────────────────────────────────────────────────────

export function fZAR(v: number): string {
  if (!isFinite(v) || v === 0) return '\u2014';
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `${v < 0 ? '-' : ''}R\u00a0${s}`;
}

export function fPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function fNum(v: number): string {
  return Math.round(v).toLocaleString('en-ZA').replace(/,/g, '\u00a0');
}

// ─── EditableCell ────────────────────────────────────────────────────────────

interface EditableCellProps {
  value: number;
  onCommit: (val: string) => void;
  type?: 'number' | 'percent';
}

export function EditableCell({ value, onCommit, type = 'number' }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const display = type === 'percent' ? `${(value * 100).toFixed(1)}%` : fNum(value);

  const startEdit = () => {
    setDraft(type === 'percent' ? String(value * 100) : String(value));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    setEditing(false);
    const committed = type === 'percent' ? String(Number(draft) / 100) : draft;
    onCommit(committed);
  };

  if (editing) {
    return (
      <td className="px-3 py-2 text-sm text-right bg-gray-700 border border-teal-600" style={{ minWidth: 80 }}>
        <input
          ref={inputRef}
          type="number"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="w-full bg-transparent outline-none text-sm text-right font-medium text-gray-100 tabular-nums"
        />
      </td>
    );
  }

  return (
    <td
      className="px-3 py-2 text-sm text-right bg-gray-800/60 border border-gray-700 cursor-text hover:bg-gray-700/60 hover:border-gray-600 transition-colors"
      style={{ minWidth: 80 }}
      onClick={startEdit}
    >
      <span className="font-medium text-gray-300 tabular-nums">{display}</span>
    </td>
  );
}

// ─── ReadCell ────────────────────────────────────────────────────────────────

export function ReadCell({ value, format = 'zar' }: { value: number; format?: 'zar' | 'pct' | 'num' }) {
  const display = format === 'zar' ? fZAR(value) : format === 'pct' ? fPct(value) : fNum(value);
  const isNeg = value < 0;
  const isGoodGP = format === 'pct' && value >= 0.30;
  const isAmberGP = format === 'pct' && value >= 0.10 && value < 0.30;

  let color = 'text-gray-300';
  if (format === 'zar' && isNeg) color = 'text-red-400';
  if (format === 'pct') {
    if (isGoodGP) color = 'text-emerald-400';
    else if (isAmberGP) color = 'text-amber-400';
    else color = 'text-red-400';
  }

  return (
    <td className="px-3 py-2 text-sm text-right bg-gray-800/40 border border-gray-700" style={{ minWidth: 90 }}>
      <span className={`tabular-nums ${color}`}>{display}</span>
    </td>
  );
}
