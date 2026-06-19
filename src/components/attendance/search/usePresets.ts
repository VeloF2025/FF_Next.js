/**
 * usePresets — preset CRUD logic for Pulse · Search.
 *
 * Encapsulates: fetching the preset list, auto-applying the default on cold
 * open, and the save/apply/update/delete handlers. Lifts heavy async logic
 * out of the shell page so the page file stays under 300 lines.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { log } from '@/lib/logger';
import { filterJsonToForm, formToFilterJson } from './searchUtils';
import type { PresetDto, FormState } from './types';

interface UsePresetsOpts {
  routerIsReady: boolean;
  routerQueryIsEmpty: boolean;
  committedForm: FormState;
  setForm: (f: FormState) => void;
  setCommittedForm: (f: FormState) => void;
  setPage: (p: number) => void;
}

interface UsePresetsReturn {
  presets: PresetDto[];
  presetsLoading: boolean;
  presetActionMsg: string | null;
  loadPresets: () => Promise<PresetDto[]>;
  onSavePreset: (name: string, setAsDefault: boolean) => Promise<void>;
  onApplyPreset: (preset: PresetDto) => void;
  onUpdatePreset: (id: string, patch: Partial<{ name: string; is_default: boolean }>) => Promise<void>;
  onDeletePreset: (preset: PresetDto) => Promise<void>;
}

export function usePresets({
  routerIsReady,
  routerQueryIsEmpty,
  committedForm,
  setForm,
  setCommittedForm,
  setPage,
}: UsePresetsOpts): UsePresetsReturn {
  const [presets, setPresets] = useState<PresetDto[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetActionMsg, setPresetActionMsg] = useState<string | null>(null);
  const presetDidAutoLoad = useRef(false);

  const loadPresets = useCallback(async (): Promise<PresetDto[]> => {
    setPresetsLoading(true);
    try {
      const res = await fetch('/api/staff/attendance-presets', { credentials: 'include' });
      const body = (await res.json()) as
        | { success: true; data: { presets: PresetDto[] } }
        | { success: false; error?: { message?: string } };
      if (!res.ok || !('success' in body) || !body.success) {
        log.warn('PulseSearch presets load failed', {
          status: res.status,
          message: 'success' in body && body.success === false ? body.error?.message : undefined,
        });
        return [];
      }
      setPresets(body.data.presets);
      return body.data.presets;
    } catch (err) {
      log.error('PulseSearch presets load network error', err instanceof Error ? { message: err.message } : { err });
      return [];
    } finally {
      setPresetsLoading(false);
    }
  }, []);

  // Auto-apply default preset on cold open (URL has no filter params).
  useEffect(() => {
    if (!routerIsReady || presetDidAutoLoad.current) return;
    presetDidAutoLoad.current = true;
    const urlIsCold = routerQueryIsEmpty;
    void (async () => {
      const list = await loadPresets();
      if (!urlIsCold) return;
      const def = list.find((p) => p.is_default);
      if (!def) return;
      const fromPreset = filterJsonToForm(def.filter);
      setForm(fromPreset);
      setCommittedForm(fromPreset);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerIsReady, loadPresets]);

  const onSavePreset = async (name: string, setAsDefault: boolean) => {
    setPresetActionMsg(null);
    try {
      const res = await fetch('/api/staff/attendance-presets', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, filter: formToFilterJson(committedForm), is_default: setAsDefault }),
      });
      const body = (await res.json()) as
        | { success: true; data: { preset: PresetDto } }
        | { success: false; error?: { message?: string } };
      if (!res.ok || !('success' in body) || !body.success) {
        const msg = 'success' in body && body.success === false ? body.error?.message : null;
        setPresetActionMsg(msg ?? 'Could not save preset.');
        return;
      }
      setPresetActionMsg(`Saved "${body.data.preset.name}".`);
      await loadPresets();
    } catch (err) {
      log.error('PulseSearch save preset failed', err instanceof Error ? { message: err.message } : { err });
      setPresetActionMsg('Network error saving preset.');
    }
  };

  const onApplyPreset = (preset: PresetDto) => {
    const next = filterJsonToForm(preset.filter);
    setForm(next);
    setCommittedForm(next);
    setPage(1);
    setPresetActionMsg(`Loaded "${preset.name}".`);
  };

  const onUpdatePreset = async (id: string, patch: Partial<{ name: string; is_default: boolean }>) => {
    setPresetActionMsg(null);
    try {
      const res = await fetch('/api/staff/attendance-presets', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setPresetActionMsg(body?.error?.message ?? 'Could not update preset.');
        return;
      }
      await loadPresets();
      setPresetActionMsg('Preset updated.');
    } catch (err) {
      log.error('PulseSearch update preset failed', err instanceof Error ? { message: err.message } : { err });
      setPresetActionMsg('Network error updating preset.');
    }
  };

  const onDeletePreset = async (preset: PresetDto) => {
    setPresetActionMsg(null);
    try {
      const res = await fetch(`/api/staff/attendance-presets?id=${encodeURIComponent(preset.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setPresetActionMsg(body?.error?.message ?? 'Could not delete preset.');
        return;
      }
      await loadPresets();
      setPresetActionMsg(`Deleted "${preset.name}".`);
    } catch (err) {
      log.error('PulseSearch delete preset failed', err instanceof Error ? { message: err.message } : { err });
      setPresetActionMsg('Network error deleting preset.');
    }
  };

  return {
    presets,
    presetsLoading,
    presetActionMsg,
    loadPresets,
    onSavePreset,
    onApplyPreset,
    onUpdatePreset,
    onDeletePreset,
  };
}
