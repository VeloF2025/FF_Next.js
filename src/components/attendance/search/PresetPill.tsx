/**
 * PresetPill — individual saved-preset chip with inline rename/delete UI.
 *
 * Replaces window.prompt / window.confirm (audit issue #2005) with:
 *   - Rename: inline input row (Enter=confirm, Escape=cancel).
 *   - Delete: inline "Delete [name]? Confirm / Cancel" row.
 *
 * No native dialog APIs (window.prompt / window.confirm / window.alert)
 * are used anywhere in this file.
 */

import { useState, type KeyboardEvent } from 'react';
import type { PresetDto } from './types';

// ---------------------------------------------------------------------------
// Types for inline editing state
// ---------------------------------------------------------------------------

type InlineMode =
  | { kind: 'rename'; draftName: string }
  | { kind: 'delete' }
  | null;

// ---------------------------------------------------------------------------
// PresetMenuItem helper
// ---------------------------------------------------------------------------

function PresetMenuItem({
  label, onClick, destructive,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 hover:bg-neutral-800/60 ${
        destructive ? 'text-red-300' : 'text-neutral-300'
      }`}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PresetPill
// ---------------------------------------------------------------------------

interface PresetPillProps {
  preset: PresetDto;
  onApply: (p: PresetDto) => void;
  onUpdate: (id: string, patch: Partial<{ name: string; is_default: boolean }>) => void;
  onDelete: (p: PresetDto) => void;
}

export function PresetPill({ preset: p, onApply, onUpdate, onDelete }: PresetPillProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [inline, setInline] = useState<InlineMode>(null);

  const confirmRename = (draftName: string) => {
    const trimmed = draftName.trim();
    if (trimmed.length > 0 && trimmed !== p.name) onUpdate(p.id, { name: trimmed });
    setInline(null);
  };

  const handleRenameKey = (e: KeyboardEvent<HTMLInputElement>, draftName: string) => {
    if (e.key === 'Enter') confirmRename(draftName);
    if (e.key === 'Escape') setInline(null);
  };

  if (inline?.kind === 'rename') {
    return (
      <span className="flex items-center gap-1">
        <input
          autoFocus
          type="text"
          defaultValue={inline.draftName}
          onKeyDown={(e) => handleRenameKey(e, e.currentTarget.value)}
          onBlur={(e) => confirmRename(e.currentTarget.value)}
          maxLength={60}
          className="px-2 py-0.5 rounded border border-neutral-600 bg-neutral-950 text-neutral-100 text-xs focus:border-emerald-600 focus:outline-none w-40"
        />
        <button type="button" onClick={() => setInline(null)}
          className="px-2 py-0.5 rounded border border-neutral-700 text-neutral-400 text-xs hover:bg-neutral-800/60">
          Cancel
        </button>
      </span>
    );
  }

  if (inline?.kind === 'delete') {
    return (
      <span className="flex items-center gap-1 text-xs">
        <span className="text-neutral-400">Delete &ldquo;{p.name}&rdquo;?</span>
        <button type="button" onClick={() => { onDelete(p); setInline(null); }}
          className="px-2 py-0.5 rounded bg-red-900/40 border border-red-700 text-red-200 text-xs hover:bg-red-800/60">
          Confirm
        </button>
        <button type="button" onClick={() => setInline(null)}
          className="px-2 py-0.5 rounded border border-neutral-700 text-neutral-400 text-xs hover:bg-neutral-800/60">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => onApply(p)}
        className={`px-3 py-1 rounded-full text-xs border ${
          p.is_default
            ? 'bg-amber-900/40 border-amber-700 text-amber-200'
            : 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:bg-neutral-800/60'
        }`}
        title={p.is_default ? 'Default preset — auto-loads on cold open' : 'Click to apply'}>
        {p.is_default ? '★ ' : ''}{p.name}
      </button>
      <button type="button" aria-label={`Preset menu for ${p.name}`}
        onClick={() => setMenuOpen((s) => !s)}
        className="ml-0.5 px-1 py-1 text-xs text-neutral-600 hover:text-neutral-300">
        ⋯
      </button>
      {menuOpen && (
        <div className="absolute z-10 mt-1 right-0 min-w-[180px] rounded-lg border border-neutral-800 bg-neutral-900 shadow-md py-1 text-sm">
          <PresetMenuItem
            label={p.is_default ? 'Clear default' : 'Set as default'}
            onClick={() => { onUpdate(p.id, { is_default: !p.is_default }); setMenuOpen(false); }}
          />
          <PresetMenuItem
            label="Rename…"
            onClick={() => { setMenuOpen(false); setInline({ kind: 'rename', draftName: p.name }); }}
          />
          <PresetMenuItem label="Delete" destructive
            onClick={() => { setMenuOpen(false); setInline({ kind: 'delete' }); }}
          />
        </div>
      )}
    </div>
  );
}
