/**
 * The dedicated training-certificate permission checks.
 *
 * Split out of staffAccessService so it depends on nothing but the permission
 * store: staffAccessService imports these to make its document helpers
 * type-aware, and importing back the other way would be a cycle.
 *
 * Every check fails closed. A permission store that is down must not read as
 * "allowed" for a certificate binary.
 */

import { userHasPermission } from '@/lib/permissions';
import { STAFF_TRAINING_CERTIFICATES_PERMISSION } from '@/types/staff/access.types';
import { createLogger } from '@/lib/logger';

const log = createLogger('TrainingCertificateAccess');

export type TrainingCertificateAction = 'view' | 'create' | 'edit' | 'delete';

/** The document type the dedicated permission governs. */
export const CERTIFICATION_DOCUMENT_TYPE = 'certification';

async function hasTrainingCertificatePermission(
  userId: string,
  action: TrainingCertificateAction
): Promise<boolean> {
  try {
    return await userHasPermission(userId, STAFF_TRAINING_CERTIFICATES_PERMISSION, action);
  } catch (error) {
    log.error('Training certificate permission check failed', { userId, action, error });
    return false;
  }
}

/** See certificate metadata and download the binary. */
export function canAccessTrainingCertificates(userId: string): Promise<boolean> {
  return hasTrainingCertificatePermission(userId, 'view');
}

/** Upload a certificate and create the pending competency records. */
export function canCreateTrainingCertificates(userId: string): Promise<boolean> {
  return hasTrainingCertificatePermission(userId, 'create');
}

/** Verify, reject or revoke a submission. */
export function canEditTrainingCertificates(userId: string): Promise<boolean> {
  return hasTrainingCertificatePermission(userId, 'edit');
}

/** Delete a submission that has not been verified. */
export function canDeleteTrainingCertificates(userId: string): Promise<boolean> {
  return hasTrainingCertificatePermission(userId, 'delete');
}
