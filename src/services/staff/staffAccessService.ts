/**
 * Staff Access Service
 * Handles permission checks and field filtering for staff sensitive data
 */

import { neon } from '@/lib/db-neon';
import { userHasPermission } from '@/lib/permissions';
import {
  STAFF_SENSITIVE_PERMISSION,
  SENSITIVE_FIELDS,
  LIMITED_FIELDS,
  type StaffAccessLevel,
  type StaffAccessResult,
} from '@/types/staff/access.types';
import {
  CERTIFICATION_DOCUMENT_TYPE,
  canAccessTrainingCertificates,
  canCreateTrainingCertificates,
  canEditTrainingCertificates,
  canDeleteTrainingCertificates,
} from './trainingCertificateAccess';
import { createLogger } from '@/lib/logger';

export { STAFF_TRAINING_CERTIFICATES_PERMISSION } from '@/types/staff/access.types';
export {
  canAccessTrainingCertificates,
  canCreateTrainingCertificates,
  canEditTrainingCertificates,
  canDeleteTrainingCertificates,
} from './trainingCertificateAccess';

const sql = neon(process.env.DATABASE_URL!);
const log = createLogger('StaffAccessService');

/**
 * Check if a user can access sensitive staff data
 * Returns true for HR admins with the sensitive permission
 */
export async function canAccessSensitiveStaffData(userId: string): Promise<boolean> {
  try {
    return await userHasPermission(userId, STAFF_SENSITIVE_PERMISSION, 'view');
  } catch (error) {
    log.error('Error checking sensitive staff access', { userId, error });
    return false;
  }
}

/**
 * Check if a user can edit sensitive staff data
 * Returns true for HR admins with edit permission
 */
export async function canEditSensitiveStaffData(userId: string): Promise<boolean> {
  try {
    return await userHasPermission(userId, STAFF_SENSITIVE_PERMISSION, 'edit');
  } catch (error) {
    log.error('Error checking sensitive staff edit access', { userId, error });
    return false;
  }
}

/**
 * Get the staff record linked to a user account (for self-view detection)
 */
export async function getStaffIdForUser(userId: string): Promise<string | null> {
  try {
    const result = await sql`
      SELECT id FROM staff WHERE user_id = ${userId} LIMIT 1
    `;
    return result.length > 0 ? result[0]?.id ?? null : null;
  } catch (error) {
    log.error('Error getting staff ID for user', { userId, error });
    return null;
  }
}

/**
 * Check staff access level for a user
 * @param userId - The authenticated user's ID
 * @param targetStaffId - The staff record being accessed (optional)
 */
export async function checkStaffAccess(
  userId: string,
  targetStaffId?: string
): Promise<StaffAccessResult> {
  // Check if user has sensitive permission
  const [canViewSensitive, canEditSensitive, userStaffId] = await Promise.all([
    canAccessSensitiveStaffData(userId),
    canEditSensitiveStaffData(userId),
    getStaffIdForUser(userId),
  ]);

  // Check if this is a self-view
  const isSelfView = targetStaffId !== undefined && userStaffId === targetStaffId;

  // Determine access level
  let level: StaffAccessLevel;
  if (canViewSensitive) {
    level = 'full';
  } else if (isSelfView) {
    level = 'self';
  } else {
    level = 'limited';
  }

  return {
    level,
    canViewSensitive,
    canEditSensitive,
    isSelfView,
  };
}

/**
 * Filter sensitive fields from a staff record based on access level
 * @param staff - The staff record to filter
 * @param access - The access check result
 */
export function filterStaffFields<T extends Record<string, unknown>>(
  staff: T,
  access: StaffAccessResult
): T {
  // Full access - return everything
  if (access.level === 'full') {
    return staff;
  }

  // Self-view - can see own sensitive data but still filter some fields
  if (access.level === 'self') {
    return staff;
  }

  // Limited access - remove sensitive fields
  const filtered = { ...staff };
  const sensitiveSet = new Set(SENSITIVE_FIELDS);

  for (const key of Object.keys(filtered)) {
    if (sensitiveSet.has(key as typeof SENSITIVE_FIELDS[number])) {
      delete filtered[key];
    }
  }

  return filtered;
}

/**
 * Filter an array of staff records
 */
export function filterStaffList<T extends Record<string, unknown>>(
  staffList: T[],
  access: StaffAccessResult
): T[] {
  // For list views, self-view doesn't apply (user's own record gets filtered like others)
  const listAccess = { ...access, level: access.canViewSensitive ? 'full' : 'limited' as StaffAccessLevel, isSelfView: false };
  return staffList.map(staff => filterStaffFields(staff, listAccess));
}

/**
 * Get fields allowed for a given access level (for SQL SELECT)
 */
export function getSelectableFields(access: StaffAccessResult): string[] {
  if (access.canViewSensitive || access.isSelfView) {
    return ['*']; // All fields
  }
  return [...LIMITED_FIELDS];
}

/**
 * Check if a user can access documents for a staff member
 * - HR admins can access all documents
 * - Users can access their own documents
 */
export async function canAccessStaffDocuments(
  userId: string,
  targetStaffId: string
): Promise<boolean> {
  const access = await checkStaffAccess(userId, targetStaffId);
  return access.canViewSensitive || access.isSelfView;
}

/**
 * Check if a user can read one specific document.
 *
 * Type-aware: a certification is a training certificate, reachable either by the
 * dedicated view permission or by the existing HR/self scope. Every other type
 * keeps exactly the previous rule, so this narrows nothing that used to work.
 */
export async function canAccessStaffDocument(
  userId: string,
  targetStaffId: string,
  documentType: string
): Promise<boolean> {
  if (documentType === CERTIFICATION_DOCUMENT_TYPE) {
    if (await canAccessTrainingCertificates(userId)) {
      return true;
    }
  }
  return canAccessStaffDocuments(userId, targetStaffId);
}

/**
 * Check if a user can upload documents for a staff member
 * - Certifications require the dedicated create permission
 * - HR admins can upload every other type for anyone
 * - Users can upload their own driver's license
 */
export async function canUploadStaffDocument(
  userId: string,
  targetStaffId: string,
  documentType?: string
): Promise<boolean> {
  // Uploading a certificate creates competency evidence, which is what the
  // dedicated permission exists to control. HR-sensitive edit is not a
  // substitute, and version one has no employee self-submission.
  if (documentType === CERTIFICATION_DOCUMENT_TYPE) {
    return canCreateTrainingCertificates(userId);
  }

  const access = await checkStaffAccess(userId, targetStaffId);

  // HR admins can upload anything
  if (access.canEditSensitive) {
    return true;
  }

  // Self can upload driver's license
  if (access.isSelfView && documentType === 'drivers_license') {
    return true;
  }

  return false;
}

/**
 * Check if a user can delete one specific document.
 *
 * Certifications require the dedicated delete permission; nothing else may
 * remove competency evidence. Other types require HR edit — previously these
 * routes checked nothing at all.
 */
export async function canDeleteStaffDocument(
  userId: string,
  targetStaffId: string,
  documentType: string
): Promise<boolean> {
  if (documentType === CERTIFICATION_DOCUMENT_TYPE) {
    return canDeleteTrainingCertificates(userId);
  }
  const access = await checkStaffAccess(userId, targetStaffId);
  return access.canEditSensitive;
}

/**
 * Check if a user can approve/verify documents.
 *
 * Verifying a certificate turns pending evidence into evidence that satisfies a
 * statutory gate, so it needs the dedicated edit permission — notably, a
 * create-only custodian cannot approve their own submission.
 */
export async function canApproveDocuments(
  userId: string,
  documentType?: string
): Promise<boolean> {
  if (documentType === CERTIFICATION_DOCUMENT_TYPE) {
    return canEditTrainingCertificates(userId);
  }
  return canEditSensitiveStaffData(userId);
}

export { getExportColumns } from './staffExportColumns';
