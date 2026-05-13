import { useState } from 'react';
import { usePoleDetail } from '../hooks/usePoleDetail';
import { PhotoSlotCard } from './PhotoSlotCard';
import { TrayBucket } from './TrayBucket';
import { ApprovePoleButton } from './ApprovePoleButton';
import { SLOT_META } from '../utils/slot-keys';
import { photoUrl } from '../utils/photo-url';
import { log } from '@/lib/logger';
import { PhotoLightbox, type LightboxPhoto } from '@/components/PhotoLightbox';
import type { PoleQaPhoto } from '../types/works-qa.types';

interface PoleDetailPanelProps {
  poleId: string | null;
  onClose: () => void;
}

async function assignPhoto(poleId: string, slot: string, file: File) {
  const form = new FormData();
  form.append('pole_id', poleId);
  form.append('slot', slot);
  form.append('photo', file);
  form.append('source', 'upload');
  const res = await fetch('/api/works-qa/pole-assign', { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
}

async function overrideSlot(poleId: string, slot: string, decision: 'pass' | 'fail', reason: string) {
  const res = await fetch('/api/works-qa/pole-override', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pole_id: poleId, slot, decision, reason }),
  });
  if (!res.ok) throw new Error(`Override failed: ${res.status}`);
}

async function uploadTrayPhotos(poleId: string, files: File[]) {
  for (const file of files) {
    const form = new FormData();
    form.append('pole_id', poleId);
    form.append('slot', 'tray');
    form.append('photo', file);
    form.append('source', 'upload');
    const res = await fetch('/api/works-qa/pole-assign', { method: 'POST', body: form });
    if (!res.ok) {
      log.error('works-qa: tray upload failed', { status: res.status });
    }
  }
}

const CIVIL_SLOTS = SLOT_META.filter(s => s.discipline === 'civil');
const DOME_SLOTS = SLOT_META.filter(s => s.discipline === 'dome');
const JOINT_SLOTS = SLOT_META.filter(s => s.discipline === 'joint');

function buildLightboxPhotos(pole: PoleQaPhoto): { photos: LightboxPhoto[]; slotIndex: Record<string, number>; trayIndex: number[] } {
  const photos: LightboxPhoto[] = [];
  const slotIndex: Record<string, number> = {};
  for (const slot of SLOT_META) {
    const key = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
    if (!key) continue;
    slotIndex[slot.key] = photos.length;
    const vlm = pole.vlm_results[slot.key];
    const metadata = vlm?.overridden_by
      ? `Overridden by ${vlm.overridden_by}${vlm.override_reason ? ` — ${vlm.override_reason}` : ''}`
      : vlm?.feedback || undefined;
    photos.push({ url: photoUrl(key), label: `${slot.label} — ${pole.pole_label}`, metadata });
  }
  const trayIndex: number[] = [];
  pole.optical_joint_tray_keys.forEach((key, i) => {
    trayIndex.push(photos.length);
    photos.push({ url: photoUrl(key), label: `Tray ${i + 1} — ${pole.pole_label}` });
  });
  return { photos, slotIndex, trayIndex };
}

export function PoleDetailPanel({ poleId, onClose }: PoleDetailPanelProps) {
  const { pole, isLoading, mutate } = usePoleDetail(poleId);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (!poleId) return null;

  const { photos, slotIndex, trayIndex } = pole
    ? buildLightboxPhotos(pole)
    : { photos: [], slotIndex: {}, trayIndex: [] };

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <span className="font-semibold text-zinc-100">
          {pole ? `Pole ${pole.pole_label}` : 'Loading…'}
        </span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">×</button>
      </div>

      {isLoading && (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">Loading…</div>
      )}

      {pole && (
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {/* Civil Section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Civil</h3>
              <span className="text-xs text-zinc-500">
                {CIVIL_SLOTS.filter(s => pole[s.dbColumn as keyof typeof pole]).length}/{CIVIL_SLOTS.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {CIVIL_SLOTS.map(slot => (
                <PhotoSlotCard
                  key={slot.key}
                  slotKey={slot.key}
                  label={slot.label}
                  photoKey={pole[slot.dbColumn as keyof typeof pole] as string | null}
                  vlm={pole.vlm_results[slot.key]}
                  onUpload={file => assignPhoto(pole.id, slot.key, file).then(() => mutate()).catch((e: unknown) => log.error('works-qa: upload failed', { error: e instanceof Error ? e.message : String(e) }))}
                  onOverride={(d, r) => overrideSlot(pole.id, slot.key, d, r).then(() => mutate()).catch((e: unknown) => log.error('works-qa: override failed', { error: e instanceof Error ? e.message : String(e) }))}
                  onView={slotIndex[slot.key] !== undefined ? () => setLightboxIndex(slotIndex[slot.key]!) : undefined}
                  disabled={!!pole.approved_at}
                />
              ))}
            </div>
          </section>

          {/* Optical Dome Section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Optical Dome</h3>
              <span className="text-xs text-zinc-500">
                {DOME_SLOTS.filter(s => pole[s.dbColumn as keyof typeof pole]).length}/{DOME_SLOTS.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {DOME_SLOTS.map(slot => (
                <PhotoSlotCard
                  key={slot.key}
                  slotKey={slot.key}
                  label={slot.label}
                  photoKey={pole[slot.dbColumn as keyof typeof pole] as string | null}
                  vlm={pole.vlm_results[slot.key]}
                  onUpload={file => assignPhoto(pole.id, slot.key, file).then(() => mutate()).catch((e: unknown) => log.error('works-qa: upload failed', { error: e instanceof Error ? e.message : String(e) }))}
                  onOverride={(d, r) => overrideSlot(pole.id, slot.key, d, r).then(() => mutate()).catch((e: unknown) => log.error('works-qa: override failed', { error: e instanceof Error ? e.message : String(e) }))}
                  onView={slotIndex[slot.key] !== undefined ? () => setLightboxIndex(slotIndex[slot.key]!) : undefined}
                  disabled={!!pole.approved_at}
                />
              ))}
            </div>
          </section>

          {/* Optical Joint Section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Optical Joint</h3>
              <span className="text-xs text-zinc-500">
                {JOINT_SLOTS.filter(s => pole[s.dbColumn as keyof typeof pole]).length}/{JOINT_SLOTS.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {JOINT_SLOTS.map(slot => (
                <PhotoSlotCard
                  key={slot.key}
                  slotKey={slot.key}
                  label={slot.label}
                  photoKey={pole[slot.dbColumn as keyof typeof pole] as string | null}
                  vlm={pole.vlm_results[slot.key]}
                  onUpload={file => assignPhoto(pole.id, slot.key, file).then(() => mutate()).catch((e: unknown) => log.error('works-qa: upload failed', { error: e instanceof Error ? e.message : String(e) }))}
                  onOverride={(d, r) => overrideSlot(pole.id, slot.key, d, r).then(() => mutate()).catch((e: unknown) => log.error('works-qa: override failed', { error: e instanceof Error ? e.message : String(e) }))}
                  onView={slotIndex[slot.key] !== undefined ? () => setLightboxIndex(slotIndex[slot.key]!) : undefined}
                  disabled={!!pole.approved_at}
                />
              ))}
            </div>
            <TrayBucket
              trayKeys={pole.optical_joint_tray_keys}
              onUpload={files => uploadTrayPhotos(pole.id, files).then(() => mutate()).catch((e: unknown) => log.error('works-qa: tray upload error', { error: e instanceof Error ? e.message : String(e) }))}
              onView={i => { const idx = trayIndex[i]; if (idx !== undefined) setLightboxIndex(idx); }}
              disabled={!!pole.approved_at}
            />
          </section>
        </div>
      )}

      {/* Footer */}
      {pole && (
        <div className="px-5 py-4 border-t border-zinc-800 flex items-center justify-between">
          <ApprovePoleButton pole={pole} onApproved={() => mutate()} />
        </div>
      )}

      {lightboxIndex !== null && photos.length > 0 && (
        <PhotoLightbox
          photos={photos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
