import { useState, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { ChevronDown } from 'lucide-react';
import { usePoleDetail } from '../hooks/usePoleDetail';
import { useAssignableUsers } from '../hooks/useAssignableUsers';
import { PhotoSlotCard } from './PhotoSlotCard';
import { TrayBucket } from './TrayBucket';
import { ApproveDisciplineButton } from './ApprovePoleButton';
import { DisciplineComments } from './DisciplineComments';
import { UnassignedBucket } from './UnassignedBucket';
import { PoleSnagsTab } from './PoleSnagsTab';
import { SLOT_META } from '../utils/slot-keys';
import {
  APPROVED_FLAG,
  CIVIL_SLOTS,
  DOME_SLOTS,
  MAIN_JOINT_SLOTS,
  buildLightboxPhotos,
  parseDraggable,
  parseDroppable,
  type PoleWithComments,
} from '../utils/pole-detail-helpers';
import {
  assignPhoto, overrideSlot, movePhoto, uploadTrayPhotos,
  approvePhotoApi, snagPhotoApi,
} from '../utils/pole-detail-api';
import type { Discipline } from '../utils/approval-gates';
import { log } from '@/lib/logger';
import { PhotoLightbox } from '@/components/PhotoLightbox';
import type { PoleQaPhoto } from '../types/works-qa.types';

interface PoleDetailPanelProps {
  poleId: string | null;
  onClose: () => void;
}

export function PoleDetailPanel({ poleId, onClose }: PoleDetailPanelProps) {
  const { pole: poleRaw, isLoading, mutate } = usePoleDetail(poleId);
  const pole = poleRaw as PoleWithComments | null;
  const { users: assignableUsers, isLoading: loadingUsers } = useAssignableUsers(pole?.project_id ?? null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [tab, setTab] = useState<'photos' | 'snags'>('photos');
  // Accordion state: SET of expanded disciplines. Multi-open.
  //
  // Defaults to ALL THREE expanded so every Droppable has measurable
  // geometry at drag start — hello-pangea/dnd captures a getBoundingClientRect
  // snapshot in onBeforeCapture; a `display: none` (collapsed) section returns
  // a zero-area bbox and silently rejects drops onto its slots. Users can
  // collapse via the header chevrons or the "Collapse all" button.
  //
  // NOTE: section content is ALWAYS mounted (visibility toggled by CSS). This
  // keeps every Droppable registered with hello-pangea/dnd for the lifetime of
  // the panel — mutating the droppable tree mid-drag silently breaks the drop
  // event and leaves the drag clone stuck mid-air.
  const [expanded, setExpanded] = useState<Set<Discipline>>(() => new Set(['civil', 'dome', 'main_joint']));

  useEffect(() => {
    setLightboxIndex(null);
    setMoveError(null);
    setExpanded(new Set(['civil', 'dome', 'main_joint']));
    setTab('photos');
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
                  slotApproval={pole.slot_approvals?.[slot.key]}
                  assignableUsers={assignableUsers}
                  loadingUsers={loadingUsers}
                  onUpload={file => assignPhoto(pole.id, slot.key, file).then(() => mutate()).catch((e: unknown) => log.error('works-qa: upload failed', { error: e instanceof Error ? e.message : String(e) }))}
                  onOverride={(d, r) => overrideSlot(pole.id, slot.key, d, r).then(() => mutate()).catch((e: unknown) => log.error('works-qa: override failed', { error: e instanceof Error ? e.message : String(e) }))}
                  onApprove={async () => { await approvePhotoApi(pole.id, slot.key); await mutate(); }}
                  onSnag={async input => {
                    const result = await snagPhotoApi(pole.id, slot.key, input);
                    if (result.status === 'created' || result.status === 'amended') await mutate();
                    return result;
                  }}
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
        <>
          <div className="flex items-stretch border-b border-zinc-800 bg-zinc-950">
            <button
              type="button"
              onClick={() => setTab('photos')}
              className={`flex-1 text-xs uppercase tracking-wider py-2 transition-colors ${
                tab === 'photos'
                  ? 'text-teal-400 border-b-2 border-teal-400'
                  : 'text-zinc-500 hover:text-zinc-300 border-b-2 border-transparent'
              }`}
            >
              Photos
            </button>
            <button
              type="button"
              onClick={() => setTab('snags')}
              className={`flex-1 text-xs uppercase tracking-wider py-2 transition-colors ${
                tab === 'snags'
                  ? 'text-red-400 border-b-2 border-red-400'
                  : 'text-zinc-500 hover:text-zinc-300 border-b-2 border-transparent'
              }`}
            >
              Snags
            </button>
          </div>

          {tab === 'photos' ? (
            <DragDropContext
              onBeforeCapture={() => {
                // Force-expand all sections BEFORE rfd captures Droppable
                // geometry; display:none yields zero bbox and silently rejects
                // drops. flushSync ensures the DOM lands before the snapshot.
                flushSync(() => setExpanded(new Set(['civil', 'dome', 'main_joint'])));
              }}
              onDragEnd={handleDragEnd}
            >
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
          ) : (
            <div className="flex-1 overflow-y-auto">
              <PoleSnagsTab poleId={pole.id} onChanged={() => { void mutate(); }} />
            </div>
          )}
        </>
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
