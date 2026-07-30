export type FeatureKind = 'pole' | 'cable' | 'drop' | 'optical';

export const PLANTING_EVENTS = new Set([
  'Pole Planted/ All Photos',
  'Pole Planted - Photos Incomplete',
  'Pole Verified/ Civil Complete',
]);

export const REMOVAL_EVENTS = new Set([
  'Pole Removed/Canceled',
  'Pole Canceled / Removed',
]);

const CIVIL_NON_PHYSICAL_EVENTS = new Set(['To be Planted']);
const IGNORED_OPTICAL_EVENTS = new Set(['Optical Complete', 'Optical WIP']);

export function featureKind(
  status: string | null,
  hasDropIdentity: boolean,
  hasCableIdentity: boolean,
): FeatureKind | 'unknown' {
  if (hasDropIdentity) return 'drop';
  if (hasCableIdentity || status?.startsWith('String ')) return 'cable';
  if (status?.startsWith('Pole ') || (status && CIVIL_NON_PHYSICAL_EVENTS.has(status))) {
    return 'pole';
  }
  if (status && IGNORED_OPTICAL_EVENTS.has(status)) return 'optical';
  return 'unknown';
}

export function isKnownStatus(status: string, kind: FeatureKind): boolean {
  if (
    PLANTING_EVENTS.has(status) ||
    REMOVAL_EVENTS.has(status) ||
    CIVIL_NON_PHYSICAL_EVENTS.has(status) ||
    IGNORED_OPTICAL_EVENTS.has(status)
  ) {
    return true;
  }
  if (
    status.startsWith('Q/A ') ||
    status.startsWith('(ADMIN) Q/A ') ||
    status.startsWith('Photo ') ||
    status.startsWith('WIP')
  ) {
    return true;
  }
  if (kind === 'cable' && status.startsWith('String ')) return true;
  return kind === 'drop' && status.startsWith('Drop ');
}
