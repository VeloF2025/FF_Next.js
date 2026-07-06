import { SLOT_META } from './slot-keys';
import type { PoleQaPhoto } from '../types/works-qa.types';

export interface ZipEntry {
  /** Full path inside the ZIP, e.g. "Zone_5/PON_999/POLE/civil/07_after_photo.jpg". */
  path: string;
  /** Storage key to resolve into an actual photo. */
  storageKey: string;
}

const CIVIL_SLOTS = SLOT_META.filter(s => s.discipline === 'civil');
const OPTICAL_SLOTS = SLOT_META.filter(s => s.discipline === 'dome' || s.discipline === 'main_joint');

/** Slot photo filename, e.g. (7, 'After Photo') -> "07_after_photo.jpg". */
export function slotFilename(stepNumber: number, label: string): string {
  return `${String(stepNumber).padStart(2, '0')}_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.jpg`;
}

/**
 * Map one pole row to its ZIP entries under `prefix`. Layout matches the
 * per-PON download (pon-zip.ts): {prefix}/{pole}/civil|optical|unassigned/...
 * Only photos with a non-null key produce an entry, so empty folders are never
 * emitted.
 */
export function poleToZipEntries(pole: PoleQaPhoto, prefix: string): ZipEntry[] {
  const base = `${prefix}/${pole.pole_label}`;
  const entries: ZipEntry[] = [];

  for (const slot of CIVIL_SLOTS) {
    const key = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
    if (key) entries.push({ path: `${base}/civil/${slotFilename(slot.stepNumber, slot.label)}`, storageKey: key });
  }

  for (const slot of OPTICAL_SLOTS) {
    const key = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
    if (key) entries.push({ path: `${base}/optical/${slotFilename(slot.stepNumber, slot.label)}`, storageKey: key });
  }

  const trayKeys = Array.isArray(pole.main_joint_tray_keys) ? pole.main_joint_tray_keys : [];
  trayKeys.forEach((key, i) => {
    if (key) entries.push({ path: `${base}/optical/tray_${String(i + 1).padStart(2, '0')}.jpg`, storageKey: key });
  });

  const unassignedKeys = Array.isArray(pole.unassigned_photo_keys) ? pole.unassigned_photo_keys : [];
  unassignedKeys.forEach((key, i) => {
    if (key) entries.push({ path: `${base}/unassigned/photo_${String(i + 1).padStart(2, '0')}.jpg`, storageKey: key });
  });

  return entries;
}
