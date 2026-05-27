import { SLOT_META } from './slot-keys';
import { photoUrl } from './photo-url';
import type { Discipline } from './approval-gates';
import type { LightboxPhoto } from '@/components/PhotoLightbox';
import type { PoleQaPhoto, PoleQaComment } from '../types/works-qa.types';

export const CIVIL_SLOTS = SLOT_META.filter(s => s.discipline === 'civil');
export const DOME_SLOTS = SLOT_META.filter(s => s.discipline === 'dome');
export const MAIN_JOINT_SLOTS = SLOT_META.filter(s => s.discipline === 'main_joint');

export const APPROVED_FLAG: Record<Discipline, keyof PoleQaPhoto> = {
  civil: 'civil_approved',
  dome: 'dome_approved',
  main_joint: 'joint_approved',
};

export interface PoleWithComments extends PoleQaPhoto {
  comments: PoleQaComment[];
}

export interface LightboxIndexes {
  photos: LightboxPhoto[];
  slotIndex: Record<string, number>;
  trayIndex: number[];
  unassignedIndex: number[];
}

export function buildLightboxPhotos(pole: PoleQaPhoto): LightboxIndexes {
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

// Parse a draggableId minted by either UnassignedBucket (`unassigned:${key}`)
// or PhotoSlotCard (`slot:${slotKey}:${photoKey}`).
export function parseDraggable(id: string): { from: string; photoKey: string } | null {
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

// Parse a droppableId: 'unassigned' or 'slot:${slotKey}'.
export function parseDroppable(id: string): string | null {
  if (id === 'unassigned') return 'unassigned';
  if (id.startsWith('slot:')) return id.slice('slot:'.length);
  return null;
}
