import { useState, useEffect } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { ChevronDown } from 'lucide-react';
import { usePoleDetail } from '../hooks/usePoleDetail';
import { PhotoSlotCard } from './PhotoSlotCard';
import { TrayBucket } from './TrayBucket';
import { ApproveDisciplineButton } from './ApprovePoleButton';
import { DisciplineComments } from './DisciplineComments';
import { UnassignedBucket } from './UnassignedBucket';
import { SLOT_META } from '../utils/slot-keys';
import { photoUrl } from '../utils/photo-url';
import type { Discipline } from '../utils/approval-gates';
import { log } from '@/lib/logger';
import { PhotoLightbox, type LightboxPhoto } from '@/components/PhotoLightbox';
import type { PoleQaPhoto, PoleQaComment } from '../types/works-qa.types';

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

async function movePhoto(poleId: string, photoKey: string, from: string, to: string) {
  const res = await fetch('/api/works-qa/move-photo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pole_id: poleId, photo_key: photoKey, from, to }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Move failed: ${res.status}`);
  }
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
const MAIN_JOINT_SLOTS = SLOT_META.filter(s => s.discipline === 'main_joint');

const APPROVED_FLAG: Record<Discipline, keyof PoleQaPhoto> = {
  civil: 'civil_approved',
  dome: 'dome_approved',
  main_joint: 'joint_approved',
};

interface PoleWithComments extends PoleQaPhoto {
  comments: PoleQaComment[];
}

function buildLightboxPhotos(pole: PoleQaPhoto): { photos: LightboxPhoto[]; slotIndex: Record<string, number>; trayIndex: number[]; unassignedIndex: number[] } {
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
  pole.main_joint_tray_keys.forEach((key, i) => {
    trayIndex.push(photos.length);
    photos.push({ url: photoUrl(key), label: `Tray ${i + 1} — ${pole.pole_label}` });
  });
  const unassignedIndex: number[] = [];
  (pole.unassigned_photo_keys ?? []).forEach((key, i) => {
    unassignedIndex.push(photos.length);
    photos.push({ url: photoUrl(key), label: `Unassigned ${i + 1} — ${pole.pole_label}` });
  });
  return { photos, slotIndex, trayIndex, unassignedIndex };
}

/**
 * Parse a draggableId minted by either UnassignedBucket (`unassigned:${key}`) or
 * PhotoSlotCard (`slot:${slotKey}:${photoKey}`).
 */
function parseDraggable(id: string): { from: string; photoKey: string } | null {
  if (id.startsWith('unassigned:')) {
    return { from: 'unassigned', photoKey: id.slice('unassigned:'.length) };
  }
  if (id.startsWith('slot:')) {
    const rest = id.slice('slot:'.length);
    const colon = rest.indexOf(':');
    if (colon === -1) return null;
    return { from: rest.slice(0, colon), photoKey: rest.slice(colon + 1) };
  }
  return null;
}

/** Parse a droppableId: 'unassigned' or 'slot:${slotKey}'. */
function parseDroppable(id: string): string | null {
  if (id === 'unassigned') return 'unassigned';
  if (id.startsWith('slot:')) return id.slice('slot:'.length);
  return null;
}

export function PoleDetailPanel({ poleId, onClose }: PoleDetailPanelProps) {
  const { pole: poleRaw, isLoading, mutate } = usePoleDetail(poleId);
  const pole = poleRaw as PoleWithComments | null;
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  // Accordion state: SET of expanded disciplines. Multi-open so the user can
  // keep multiple sections visible at once. Defaults to civil on each new pole.
  // NOTE: section content is ALWAYS mounted (only visibility is toggled). This
  // keeps every Droppable registered with hello-pangea/dnd for the lifetime of
  // the panel — mutating the droppable tree mid-drag silently breaks the drop
  // event and leaves the drag clone stuck mid-air.
  const [expanded, setExpanded] = useState<Set<Discipline>>(() => new Set(['civil']));

  useEffect(() => {
    setLightboxIndex(null);
    setMoveError(null);
    setExpanded(new Set(['civil']));
  }, [poleId]);

  function toggleSection(d: Discipline) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  if (!poleId) return null;

  const { photos, slotIndex, trayIndex, unassignedIndex } = pole
    ? buildLightboxPhotos(pole)
    : { photos: [], slotIndex: {}, trayIndex: [], unassignedIndex: [] };

  const comments = pole?.comments ?? [];

  async function handleDragEnd(result: DropResult) {
    if (!pole) return;
    setMoveError(null);
    const { destination, draggableId } = result;
    if (!destination) return;
    const parsedDrag = parseDraggable(draggableId);
    const to = parseDroppable(destination.droppableId);
    if (!parsedDrag || !to || parsedDrag.from === to) return;
    try {
      await movePhoto(pole.id, parsedDrag.photoKey, parsedDrag.from, to);
      await mutate();
      // After a successful move, expand the destination's discipline so the
      // user sees where the photo landed.
      if (to !== 'unassigned') {
        const meta = SLOT_META.find(s => s.key === to);
        if (meta) setExpanded(prev => new Set(prev).add(meta.discipline));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('works-qa: move-photo failed', { error: msg });
      setMoveError(msg);
    }
  }

  function renderSection(label: string, discipline: Discipline, slots: typeof CIVIL_SLOTS, extra?: React.ReactNode) {
    if (!pole) return null;
    const filled = slots.filter(s => pole[s.dbColumn as keyof PoleQaPhoto]).length;
    const disciplineApproved = pole[APPROVED_FLAG[discipline]] === true;
    const isOpen = expanded.has(discipline);
    const commentCount = comments.filter(c => c.discipline === discipline).length;

    return (
      <section className="border border-zinc-800 rounded-lg">
        <button
          type="button"
          onClick={() => toggleSection(discipline)}
          aria-expanded={isOpen}
          className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-zinc-900/50 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <ChevronDown
              className={`w-4 h-4 text-zinc-500 transition-transform shrink-0 ${isOpen ? '' : '-rotate-90'}`}
            />
            <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider truncate">{label}</h3>
            {disciplineApproved && (
              <span className="text-[10px] text-green-400 shrink-0">✓ approved</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 text-xs text-zinc-500">
            <span>{filled}/{slots.length}</span>
            {commentCount > 0 && (
              <span className="text-zinc-600">· {commentCount} comment{commentCount === 1 ? '' : 's'}</span>
            )}
          </div>
        </button>

        <div className={`px-3 pb-3 flex-col gap-3 border-t border-zinc-800 ${isOpen ? 'flex' : 'hidden'}`}>
            <div className="grid grid-cols-2 gap-2 pt-3">
              {slots.map(slot => (
                <PhotoSlotCard
                  key={slot.key}
                  slotKey={slot.key}
                  label={slot.label}
                  photoKey={pole[slot.dbColumn as keyof PoleQaPhoto] as string | null}
                  vlm={pole.vlm_results[slot.key]}
                  onUpload={file => assignPhoto(pole.id, slot.key, file).then(() => mutate()).catch((e: unknown) => log.error('works-qa: upload failed', { error: e instanceof Error ? e.message : String(e) }))}
                  onOverride={(d, r) => overrideSlot(pole.id, slot.key, d, r).then(() => mutate()).catch((e: unknown) => log.error('works-qa: override failed', { error: e instanceof Error ? e.message : String(e) }))}
                  onView={slotIndex[slot.key] !== undefined ? () => setLightboxIndex(slotIndex[slot.key]!) : undefined}
                  onUnassign={() => {
                    const k = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
                    if (!k) return;
                    movePhoto(pole.id, k, slot.key, 'unassigned').then(() => mutate()).catch((e: unknown) => setMoveError(e instanceof Error ? e.message : String(e)));
                  }}
                  disabled={disciplineApproved}
                />
              ))}
            </div>

            {extra}

            <div className="flex items-center justify-between border-t border-zinc-800 pt-2">
              <ApproveDisciplineButton pole={pole} discipline={discipline} onApproved={() => mutate()} />
            </div>

            <DisciplineComments
              poleId={pole.id}
              discipline={discipline}
              comments={comments}
              disabled={disciplineApproved}
              onAdded={() => mutate()}
            />
        </div>
      </section>
    );
  }

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col z-50">
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-zinc-100">
            {pole ? `Pole ${pole.pole_label}` : 'Loading…'}
          </span>
          {pole?.approved_at && (
            <span className="text-xs text-green-400">
              ✓ All approved — {new Date(pole.approved_at).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          )}
          {moveError && (
            <span className="text-xs text-red-400">Move failed: {moveError}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const allOpen = expanded.size === 3;
              setExpanded(allOpen ? new Set() : new Set(['civil', 'dome', 'main_joint']));
            }}
            className="text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-200 transition-colors px-2 py-1 rounded border border-zinc-800 hover:border-zinc-600"
            title="Expand or collapse all sections — useful before dragging photos"
          >
            {expanded.size === 3 ? 'Collapse all' : 'Expand all'}
          </button>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">×</button>
        </div>
      </div>

      {isLoading && (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">Loading…</div>
      )}

      {pole && (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            {renderSection('Civil', 'civil', CIVIL_SLOTS)}
            {renderSection('Optical Dome', 'dome', DOME_SLOTS)}
            {renderSection('Main Joint', 'main_joint', MAIN_JOINT_SLOTS,
              <TrayBucket
                trayKeys={pole.main_joint_tray_keys}
                onUpload={files => uploadTrayPhotos(pole.id, files).then(() => mutate()).catch((e: unknown) => log.error('works-qa: tray upload error', { error: e instanceof Error ? e.message : String(e) }))}
                onView={i => { const idx = trayIndex[i]; if (idx !== undefined) setLightboxIndex(idx); }}
                disabled={pole[APPROVED_FLAG.main_joint] === true}
              />
            )}

            <UnassignedBucket
              photoKeys={pole.unassigned_photo_keys ?? []}
              onView={i => { const idx = unassignedIndex[i]; if (idx !== undefined) setLightboxIndex(idx); }}
              disabled={!!pole.approved_at}
            />
          </div>
        </DragDropContext>
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
