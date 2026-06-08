import { SLOT_META } from './slot-keys';
import type { PoleQaPhoto } from '../types/works-qa.types';

export interface LinkCandidate {
  slotKey: string;
  label: string;
  photoKey: string;
}

/**
 * Photos that may be reused to satisfy `targetSlotKey`. Restricted to the SAME
 * discipline (a depth shot can stand in for end-plates; a dome photo cannot
 * stand in for a main-joint step) and to slots that actually hold a photo.
 * The target slot itself is excluded.
 */
export function getLinkCandidates(pole: PoleQaPhoto, targetSlotKey: string): LinkCandidate[] {
  const target = SLOT_META.find(s => s.key === targetSlotKey);
  if (!target) return [];

  const candidates: LinkCandidate[] = [];
  for (const slot of SLOT_META) {
    if (slot.discipline !== target.discipline) continue;
    if (slot.key === targetSlotKey) continue;
    const photoKey = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
    if (!photoKey) continue;
    candidates.push({ slotKey: slot.key, label: slot.label, photoKey });
  }
  return candidates;
}
