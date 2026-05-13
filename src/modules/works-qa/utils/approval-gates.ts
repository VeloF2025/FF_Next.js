import { SLOT_META } from './slot-keys';
import type { PoleQaPhoto, VlmSlotResult } from '../types/works-qa.types';

export type Discipline = 'civil' | 'dome' | 'main_joint';

export interface GateResult {
  pass: boolean;
  blocking: string[];
}

/**
 * Check approval gates for a single discipline. Slots in that discipline must:
 *  1. Have a photo (slot key column non-null), AND
 *  2. Have a VLM result that's valid OR has been overridden.
 *
 * Main Joint additionally requires at least one tray photo.
 */
export function disciplineGatesPass(pole: PoleQaPhoto, discipline: Discipline): GateResult {
  const blocking: string[] = [];
  const slots = SLOT_META.filter(s => s.discipline === discipline);

  for (const slot of slots) {
    const photoKey = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
    if (!photoKey) { blocking.push(slot.key); continue; }
    const vlm = pole.vlm_results[slot.key] as VlmSlotResult | undefined;
    if (!vlm || (!vlm.valid && !vlm.overridden_by)) {
      blocking.push(slot.key);
    }
  }

  if (discipline === 'main_joint' && (pole.main_joint_tray_keys?.length ?? 0) === 0) {
    blocking.push('tray_photos');
  }

  return { pass: blocking.length === 0, blocking };
}

/**
 * Aggregate gate check (all three disciplines must pass).
 * Kept for callers that want the full picture.
 */
export function allGatesPass(pole: PoleQaPhoto): GateResult {
  const blocking: string[] = [];
  for (const discipline of ['civil', 'dome', 'main_joint'] as const) {
    blocking.push(...disciplineGatesPass(pole, discipline).blocking);
  }
  return { pass: blocking.length === 0, blocking };
}
