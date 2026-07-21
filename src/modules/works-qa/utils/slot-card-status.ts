import type { VlmSlotResult } from '../types/works-qa.types';

export type SlotCardStatus = 'empty' | 'pass' | 'fail' | 'overridden' | 'pending';

/**
 * Status for a single PhotoSlotCard. A slot is "scored" only when its VLM entry
 * carries a boolean `valid`; a photo present without a real score (pending
 * marker `{scored:false}`, or no entry yet) is 'pending' ("Awaiting AI"), never
 * a red 'fail'. Human approve/snag is handled separately by slotApproval.
 */
export function deriveSlotCardStatus(
  photoKey: string | null,
  vlm: VlmSlotResult | undefined,
): SlotCardStatus {
  if (!photoKey) return 'empty';
  if (vlm?.overridden_by) return 'overridden';
  if (typeof vlm?.valid !== 'boolean') return 'pending';
  return vlm.valid ? 'pass' : 'fail';
}
