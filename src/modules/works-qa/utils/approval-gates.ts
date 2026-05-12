import { SLOT_META } from './slot-keys';
import type { PoleQaPhoto, VlmSlotResult } from '../types/works-qa.types';

export interface GateResult {
  pass: boolean;
  blocking: string[];
}

export function allGatesPass(pole: PoleQaPhoto): GateResult {
  const blocking: string[] = [];

  for (const slot of SLOT_META) {
    const photoKey = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
    if (!photoKey) {
      blocking.push(slot.key);
      continue;
    }
    const vlm = pole.vlm_results[slot.key] as VlmSlotResult | undefined;
    if (!vlm) {
      blocking.push(slot.key);
      continue;
    }
    if (!vlm.valid && !vlm.overridden_by) {
      blocking.push(slot.key);
    }
  }

  if (pole.optical_joint_tray_keys.length === 0) {
    blocking.push('tray_photos');
  }

  return { pass: blocking.length === 0, blocking };
}
