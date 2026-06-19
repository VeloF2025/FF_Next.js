/**
 * PresetsBar — saved-filter preset toolbar for Pulse · Search (Phase B).
 *
 * Renders the preset chips row, the "Save current as preset" form, and the
 * per-action status message. Each chip is a `<PresetPill>` that owns its own
 * inline rename/delete state so no native dialog APIs are needed here.
 *
 * No window.prompt / window.confirm / window.alert anywhere in this tree.
 */

import { useState } from 'react';
import { PresetPill } from './PresetPill';
import type { PresetDto } from './types';

interface PresetsBarProps {
  presets: PresetDto[];
  loading: boolean;
  actionMsg: string | null;
  onSave: (name: string, setAsDefault: boolean) => void;
  onApply: (p: PresetDto) => void;
  onUpdate: (id: string, patch: Partial<{ name: string; is_default: boolean }>) => void;
  onDelete: (p: PresetDto) => void;
}

export function PresetsBar({
  presets, loading, actionMsg, onSave, onApply, onUpdate, onDelete,
}: PresetsBarProps) {
  const [showSave, setShowSave] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDefault, setDraftDefault] = useState(false);

  const submitSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draftName.trim();
    if (trimmed.length < 1 || trimmed.length > 60) return;
    onSave(trimmed, draftDefault);
    setShowSave(false);
    setDraftName('');
    setDraftDefault(false);
  };

  return (
    <div className="mb-3 rounded-xl bg-neutral-900 border border-neutral-800 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-neutral-500">Presets</span>

        {presets.length === 0 && !loading && (
          <span className="text-xs text-neutral-500 italic">
            No saved presets yet — capture the current filter as a preset.
          </span>
        )}

        {presets.map((p) => (
          <PresetPill
            key={p.id}
            preset={p}
            onApply={onApply}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        ))}

        <button
          type="button"
          onClick={() => setShowSave((s) => !s)}
          className="ml-auto px-3 py-1 rounded-lg border border-emerald-700 text-emerald-300 text-xs hover:bg-emerald-900/30"
        >
          {showSave ? 'Cancel' : 'Save current as preset'}
        </button>
      </div>

      {showSave && (
        <form onSubmit={submitSave} className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Preset name (≤ 60 chars)"
            maxLength={60}
            className="px-3 py-1 rounded border border-neutral-700 bg-neutral-900 text-neutral-100 text-sm flex-1 min-w-[200px] focus:border-emerald-600 focus:outline-none"
          />
          <label className="inline-flex items-center gap-1 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={draftDefault}
              onChange={(e) => setDraftDefault(e.target.checked)}
            />
            <span>Set as default</span>
          </label>
          <button
            type="submit"
            disabled={draftName.trim().length === 0}
            className="px-3 py-1 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            Save
          </button>
        </form>
      )}

      {actionMsg && (
        <div className="mt-2 text-xs text-neutral-400">{actionMsg}</div>
      )}
    </div>
  );
}
