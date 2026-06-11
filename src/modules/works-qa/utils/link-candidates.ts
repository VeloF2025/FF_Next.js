import { SLOT_META, DISCIPLINE_LABELS, type Discipline } from './slot-keys';
import type { PoleQaPhoto } from '../types/works-qa.types';

export interface LinkCandidate {
  slotKey: string;
  label: string;
  photoKey: string;
  discipline: Discipline;
  disciplineLabel: string;
}

/**
 * Photos that may be reused to satisfy `targetSlotKey`. Spans ALL disciplines —
 * one physical photo can legitimately evidence steps across civil, dome and
 * main-joint (e.g. a wide shot of a pole carrying a dome that also shows the
 * main-joint closure). Restricted only to slots that actually hold a photo; the
 * target slot itself is excluded. Each candidate carries its discipline so the
 * picker can disambiguate steps whose labels collide across disciplines (e.g.
 * "Strength Members" exists in both Dome and Main Joint).
 */
export function getLinkCandidates(pole: PoleQaPhoto, targetSlotKey: string): LinkCandidate[] {
  const target = SLOT_META.find(s => s.key === targetSlotKey);
  if (!target) return [];

  const candidates: LinkCandidate[] = [];
  for (const slot of SLOT_META) {
    if (slot.key === targetSlotKey) continue;
    const photoKey = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
    if (!photoKey) continue;
    candidates.push({
      slotKey: slot.key,
      label: slot.label,
      photoKey,
      discipline: slot.discipline,
      disciplineLabel: DISCIPLINE_LABELS[slot.discipline],
    });
  }
  return candidates;
}
