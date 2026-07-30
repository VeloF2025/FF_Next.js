const hasUnsafeCharacter = (value: string): boolean =>
  [...value].some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 || character === '\\';
  });

export function safeDocumentUrl(sourceRef: string): string | null {
  if (sourceRef !== sourceRef.trim() || hasUnsafeCharacter(sourceRef)) {
    return null;
  }
  if (sourceRef.startsWith('/storage/')) {
    const path = sourceRef.split(/[?#]/, 1)[0]!;
    if (path.split('/').some(segment => segment === '..')) return null;
    return sourceRef;
  }
  try {
    const parsed = new URL(sourceRef);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return sourceRef;
  } catch {
    return null;
  }
}

export function requireSupervisedDocumentSource(
  documentSource: RegisterDocumentInput['documentSource'],
): void {
  if (documentSource !== 'vf_storage') {
    deliveryError(
      'EVIDENCE_REQUIRED',
      'EXFO evidence requires canonical project, zone and PON mapping; upload a supervised test pack instead',
    );
  }
}
import type { RegisterDocumentInput } from '../types/zoneDelivery.types';
import { deliveryError } from './zoneDeliveryErrors';
