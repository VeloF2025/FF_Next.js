export type ZoneDeliveryErrorCode =
  | 'SCOPE_REQUIRED'
  | 'PREREQUISITE_BLOCKED'
  | 'EVIDENCE_REQUIRED'
  | 'VERSION_CONFLICT'
  | 'HANDOVER_LOCKED'
  | 'ZONE_NOT_FOUND'
  | 'VALIDATION_ERROR';

export const POSTGRES_INTEGER_MAX = 2_147_483_647;
// Browser and API clocks may differ slightly; anything beyond five minutes is material.
export const MAX_EFFECTIVE_AT_FUTURE_SKEW_MS = 5 * 60_000;

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

/**
 * Authorise a sequencing-prerequisite override, returning whether one applies.
 *
 * Fails closed on every axis: not requested → false; requested without the
 * grant → error; requested without a reason → error. The grant itself is
 * resolved at the API edge (`canOverridePrerequisites`) because it lives in a
 * different permission namespace than this module's own commands.
 */
export function requirePrerequisiteOverride(
  input: { overridePrerequisite?: boolean; reason?: string },
  actor: DeliveryActor,
): boolean {
  if (!input.overridePrerequisite) return false;
  if (actor.canOverridePrerequisites !== true) {
    deliveryError(
      'VALIDATION_ERROR',
      'Permission construction-qa.works-qa.override is required to bypass a prerequisite',
    );
  }
  if (!hasReason(input.reason)) {
    deliveryError('VALIDATION_ERROR', 'A reason is required to bypass a prerequisite');
  }
  return true;
}

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
  if (!meta.source.trim() || !Number.isSafeInteger(meta.expectedRowVersion)
    || meta.expectedRowVersion < 0 || meta.expectedRowVersion > POSTGRES_INTEGER_MAX
    || Number.isNaN(effectiveAt.valueOf())) {
    deliveryError('VALIDATION_ERROR', 'Valid source, row version and effective time are required');
  }
  if (effectiveAt.valueOf() - transactionTime.valueOf() > MAX_EFFECTIVE_AT_FUTURE_SKEW_MS) {
    deliveryError('VALIDATION_ERROR', 'Effective time is too far in the future');
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
