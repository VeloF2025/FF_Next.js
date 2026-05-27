import React from 'react';

import type { CasualDraft } from './types';

export function CasualForm({
  empCode,
  empName,
  draft,
  onChange,
  onCancel,
}: {
  empCode: string | null;
  empName: string | null;
  draft: CasualDraft;
  onChange: (draft: CasualDraft) => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-blue-800 bg-blue-950/30 p-2 space-y-1.5">
      <div className="text-[10px] text-blue-300">
        Create from {empCode ?? 'PDF'} ({empName ?? '—'})
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <input
          type="text"
          placeholder="First name"
          value={draft.firstName}
          onChange={(e) => onChange({ ...draft, firstName: e.target.value })}
          className="rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-100 px-2 py-1"
        />
        <input
          type="text"
          placeholder="Last name"
          value={draft.lastName}
          onChange={(e) => onChange({ ...draft, lastName: e.target.value })}
          className="rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-100 px-2 py-1"
        />
        <input
          type="email"
          placeholder="email@example.com"
          value={draft.email}
          onChange={(e) => onChange({ ...draft, email: e.target.value })}
          className="rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-100 px-2 py-1 col-span-2"
        />
        <input
          type="tel"
          placeholder="0XX XXX XXXX"
          value={draft.phone}
          onChange={(e) => onChange({ ...draft, phone: e.target.value })}
          className="rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-100 px-2 py-1"
        />
        <select
          value={draft.employmentType}
          onChange={(e) =>
            onChange({
              ...draft,
              employmentType: e.target.value as 'casual' | 'permanent',
            })
          }
          className="rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-100 px-2 py-1"
        >
          <option value="casual">Casual</option>
          <option value="permanent">Permanent</option>
        </select>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] text-neutral-400 hover:text-neutral-200"
        >
          cancel
        </button>
      </div>
    </div>
  );
}

export function guessFirstName(empName: string | null): string | null {
  if (!empName) return null;
  const tokens = empName.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, '').trim().split(/\s+/);
  if (tokens.length === 0) return null;
  const first = tokens[0]!;
  return first.length === 1 ? first.toUpperCase() : first;
}

export function guessLastName(empName: string | null): string | null {
  if (!empName) return null;
  const tokens = empName.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, '').trim().split(/\s+/);
  if (tokens.length < 2) return null;
  return tokens[tokens.length - 1] ?? null;
}
