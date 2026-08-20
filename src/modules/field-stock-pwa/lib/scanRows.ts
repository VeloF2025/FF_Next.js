/**
 * buildScanRows — turn a flat scanned-serial list into what the scan step renders.
 *
 * Each carton collapses to ONE row at the position of its first member, so a box
 * of nine does not bury the loose units the storeman still has to add. Loose
 * serials render individually, exactly as they always did.
 *
 * Newest-first, matching the previous `[...scanned].reverse()` ordering: the
 * thing just scanned belongs at the top of a phone screen.
 */

import type { PwaScannedSerial } from '@/modules/field-stock-pwa/types';

export type ScanRow =
  | { type: 'single'; serial: PwaScannedSerial }
  | { type: 'group'; groupId: string; label: string; members: PwaScannedSerial[] };

export function buildScanRows(scanned: PwaScannedSerial[]): ScanRow[] {
  const seenGroups = new Set<string>();
  const rows: ScanRow[] = [];

  for (const serial of scanned) {
    if (!serial.groupId) {
      rows.push({ type: 'single', serial });
      continue;
    }
    if (seenGroups.has(serial.groupId)) continue;
    seenGroups.add(serial.groupId);
    rows.push({
      type: 'group',
      groupId: serial.groupId,
      label: serial.groupLabel ?? 'Box',
      members: scanned.filter((s) => s.groupId === serial.groupId),
    });
  }

  return rows.reverse();
}
