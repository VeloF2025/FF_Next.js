export type ZoneDeliveryErrorCode =
  | 'SCOPE_REQUIRED'
  | 'PREREQUISITE_BLOCKED'
  | 'EVIDENCE_REQUIRED'
  | 'VERSION_CONFLICT'
  | 'HANDOVER_LOCKED'
  | 'ZONE_NOT_FOUND'
  | 'VALIDATION_ERROR';

export class ZoneDeliveryError extends Error {
  constructor(
    public readonly code: ZoneDeliveryErrorCode,
    message: string,
    public readonly status = code === 'ZONE_NOT_FOUND' ? 404 : undefined,
  ) {
    super(message);
    this.name = 'ZoneDeliveryError';
  }
}

export function deliveryError(
  code: ZoneDeliveryErrorCode,
  message: string,
): never {
  throw new ZoneDeliveryError(code, message);
}

export const hasReason = (reason?: string): boolean => Boolean(reason?.trim());

export function requirePermission(actor: DeliveryActor, suffix: string): void {
  const required = `construction-qa.zone-delivery.${suffix}`;
  if (actor.permission !== required) {
    deliveryError('VALIDATION_ERROR', `Permission ${required} is required`);
  }
  if (!actor.userId || !actor.email.trim()) {
    deliveryError('VALIDATION_ERROR', 'Actor identity is required');
  }
}

export function validateMeta(
  meta: CommandMeta,
  transactionTime: Date,
  correction = false,
): void {
  const effectiveAt = new Date(meta.effectiveAt);
  if (!meta.source.trim() || !Number.isInteger(meta.expectedRowVersion)
    || meta.expectedRowVersion < 0 || Number.isNaN(effectiveAt.valueOf())) {
    deliveryError('VALIDATION_ERROR', 'Valid source, row version and effective time are required');
  }
  const backdated = transactionTime.valueOf() - effectiveAt.valueOf() > 5 * 60_000;
  if ((backdated || correction) && !hasReason(meta.reason)) {
    deliveryError('VALIDATION_ERROR', 'A reason is required for backdating or correction');
  }
}

export const versionConflict = (): never =>
  deliveryError('VERSION_CONFLICT', 'The delivery projection changed; reload and retry');

export const handoverLocked = (): never =>
  deliveryError('HANDOVER_LOCKED', 'Zone handover is terminal');
import type {
  CommandMeta,
  DeliveryActor,
} from '../types/zoneDelivery.types';
