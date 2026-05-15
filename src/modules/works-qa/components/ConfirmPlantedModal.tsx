import { useState } from 'react';
import { useVerificationSnag } from '../hooks/useVerificationSnag';
import { log } from '@/lib/logger';
import type { CreateSnagRequest } from '@/modules/construction-qa/types/snag.types';

interface ConfirmPlantedModalProps {
  open: boolean;
  projectId: string;
  poleQaPhotoId: string;
  poleLabel: string;
  onClose: () => void;
  onChanged: () => void;
}

export function ConfirmPlantedModal({ open, projectId, poleQaPhotoId, poleLabel, onClose, onChanged }: ConfirmPlantedModalProps) {
  const { snag, isLoading, mutate } = useVerificationSnag(open ? projectId : null, open ? poleQaPhotoId : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function answer(planted: boolean) {
    setBusy(true);
    setError(null);
    const stamp = new Date().toISOString();
    const note = `${planted ? 'Confirmed PLANTED' : 'Confirmed NOT PLANTED'} at ${stamp}`;

    try {
      let snagId = snag?.id;
      if (!snagId) {
        const createBody: CreateSnagRequest = {
          project_id: projectId,
          category: 'verification',
          severity: 'minor',
          description: 'Confirm if pole is planted on site',
          pole_references: [poleLabel],
          pole_qa_photo_id: poleQaPhotoId,
          verification_notes: note,
        };
        const createRes = await fetch('/api/snags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createBody),
        });
        if (!createRes.ok) throw new Error(`Create failed: ${createRes.status}`);
        const created = await createRes.json() as { data?: { id: string } };
        snagId = created.data?.id;
        if (!snagId) throw new Error('Snag POST did not return an id');
      }

      if (planted && snagId) {
        const patchRes = await fetch('/api/snags', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: snagId, status: 'verified', verification_notes: note }),
        });
        if (!patchRes.ok) throw new Error(`Verify failed: ${patchRes.status}`);
      } else if (!planted && snag) {
        const merged = (snag.verification_notes ? snag.verification_notes + '\n' : '') + note;
        const patchRes = await fetch('/api/snags', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: snagId, verification_notes: merged }),
        });
        if (!patchRes.ok) throw new Error(`Note update failed: ${patchRes.status}`);
      }

      await mutate();
      onChanged();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('works-qa: confirm planted failed', { error: msg, poleLabel });
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-full max-w-md p-5 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-zinc-100 font-semibold">Confirm: Is pole {poleLabel} planted on site?</h2>

        {isLoading ? (
          <p className="text-sm text-zinc-500">Checking existing snag…</p>
        ) : snag ? (
          <div className="text-xs text-zinc-400 border border-zinc-800 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
            <div className="text-zinc-500 mb-1">Existing snag ({snag.status}):</div>
            {snag.verification_notes ?? snag.description}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">No existing verification snag for this pole.</p>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy || isLoading}
            className="px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void answer(false)}
            disabled={busy || isLoading}
            className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium disabled:opacity-40"
          >
            No — not planted
          </button>
          <button
            type="button"
            onClick={() => void answer(true)}
            disabled={busy || isLoading}
            className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-medium disabled:opacity-40"
          >
            Yes — planted
          </button>
        </div>
      </div>
    </div>
  );
}
