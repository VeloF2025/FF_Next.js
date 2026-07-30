/**
 * Type-aware staff-document authorization helpers.
 *
 * A certification document is a training certificate, and the design puts it
 * behind its own permission rather than the general HR-sensitive one: a broad
 * H&S reader may see that someone is competent without being handed the
 * certificate, and a named certificate custodian is not thereby given salaries
 * and bank details.
 *
 * Every case here is really one question — does the WRONG answer fail closed?
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { userHasPermission, sqlMock } = vi.hoisted(() => ({
  userHasPermission: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock('@/lib/permissions', () => ({ userHasPermission }));
vi.mock('@/lib/db-neon', () => ({ neon: () => sqlMock }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  STAFF_TRAINING_CERTIFICATES_PERMISSION,
  canAccessTrainingCertificates,
  canCreateTrainingCertificates,
  canEditTrainingCertificates,
  canDeleteTrainingCertificates,
  canAccessStaffDocument,
  canDeleteStaffDocument,
  canUploadStaffDocument,
  canApproveDocuments,
} from '../staffAccessService';
import { STAFF_SENSITIVE_PERMISSION } from '@/types/staff/access.types';

const HR_USER = 'hr-user';
const CUSTODIAN = 'custodian-user';
const HS_VIEWER = 'hs-viewer';
const EMPLOYEE_USER = 'employee-user';
const TARGET_STAFF = 'staff-1';
const OTHER_STAFF = 'staff-2';

/** Grant table: userId -> permissionKey -> actions. Anything absent is denied. */
type Grants = Record<string, Record<string, string[]>>;

function grant(grants: Grants): void {
  userHasPermission.mockImplementation(
    async (userId: string, key: string, action: string) =>
      grants[userId]?.[key]?.includes(action) ?? false
  );
}

/** getStaffIdForUser reads `SELECT id FROM staff WHERE user_id = ...`. */
function linkStaff(mapping: Record<string, string>): void {
  sqlMock.mockImplementation(async (_strings: unknown, userId: string) => {
    const staffId = mapping[userId];
    return staffId ? [{ id: staffId }] : [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  linkStaff({ [EMPLOYEE_USER]: TARGET_STAFF });
  grant({
    [HR_USER]: { [STAFF_SENSITIVE_PERMISSION]: ['view', 'edit'] },
    [CUSTODIAN]: {
      [STAFF_TRAINING_CERTIFICATES_PERMISSION]: ['view', 'create', 'edit', 'delete'],
    },
    [HS_VIEWER]: { 'projects.health-safety': ['view'] },
  });
});

describe('the dedicated certificate permission', () => {
  it('hangs under people.staff', () => {
    expect(STAFF_TRAINING_CERTIFICATES_PERMISSION).toBe('people.staff.training-certificates');
  });

  it('maps each action to its own check', async () => {
    grant({ [CUSTODIAN]: { [STAFF_TRAINING_CERTIFICATES_PERMISSION]: ['view'] } });
    expect(await canAccessTrainingCertificates(CUSTODIAN)).toBe(true);
    expect(await canCreateTrainingCertificates(CUSTODIAN)).toBe(false);
    expect(await canEditTrainingCertificates(CUSTODIAN)).toBe(false);
    expect(await canDeleteTrainingCertificates(CUSTODIAN)).toBe(false);
  });

  it('denies a user with no grant at all', async () => {
    expect(await canAccessTrainingCertificates(HS_VIEWER)).toBe(false);
    expect(await canCreateTrainingCertificates(HS_VIEWER)).toBe(false);
    expect(await canEditTrainingCertificates(HS_VIEWER)).toBe(false);
    expect(await canDeleteTrainingCertificates(HS_VIEWER)).toBe(false);
  });

  it('fails closed when the permission lookup itself throws', async () => {
    userHasPermission.mockRejectedValue(new Error('permission store unavailable'));
    expect(await canAccessTrainingCertificates(CUSTODIAN)).toBe(false);
    expect(await canCreateTrainingCertificates(CUSTODIAN)).toBe(false);
    expect(await canEditTrainingCertificates(CUSTODIAN)).toBe(false);
    expect(await canDeleteTrainingCertificates(CUSTODIAN)).toBe(false);
  });
});

describe('canAccessStaffDocument', () => {
  it('lets a certificate custodian read a certification document', async () => {
    expect(await canAccessStaffDocument(CUSTODIAN, TARGET_STAFF, 'certification')).toBe(true);
  });

  it('does not let a certificate custodian read other HR documents', async () => {
    expect(await canAccessStaffDocument(CUSTODIAN, TARGET_STAFF, 'bank_details')).toBe(false);
    expect(await canAccessStaffDocument(CUSTODIAN, TARGET_STAFF, 'sa_id')).toBe(false);
  });

  it('keeps full HR access to every document type', async () => {
    expect(await canAccessStaffDocument(HR_USER, TARGET_STAFF, 'certification')).toBe(true);
    expect(await canAccessStaffDocument(HR_USER, TARGET_STAFF, 'bank_details')).toBe(true);
  });

  it('keeps an employee able to read their own documents', async () => {
    expect(await canAccessStaffDocument(EMPLOYEE_USER, TARGET_STAFF, 'certification')).toBe(true);
    expect(await canAccessStaffDocument(EMPLOYEE_USER, OTHER_STAFF, 'certification')).toBe(false);
  });

  it('denies an H&S viewer the certificate', async () => {
    // They may see that the competency exists; the file is a separate grant.
    expect(await canAccessStaffDocument(HS_VIEWER, TARGET_STAFF, 'certification')).toBe(false);
  });

  it('fails closed on a lookup error', async () => {
    userHasPermission.mockRejectedValue(new Error('down'));
    expect(await canAccessStaffDocument(HR_USER, TARGET_STAFF, 'certification')).toBe(false);
  });
});

describe('canUploadStaffDocument', () => {
  it('requires the dedicated create permission for a certification', async () => {
    expect(await canUploadStaffDocument(CUSTODIAN, TARGET_STAFF, 'certification')).toBe(true);
    // Full HR edit is deliberately not enough — upload creates competency
    // evidence, which is the certificate permission's whole purpose.
    expect(await canUploadStaffDocument(HR_USER, TARGET_STAFF, 'certification')).toBe(false);
  });

  it('does not allow an employee to submit their own certificate', async () => {
    // Self-submission is explicitly out of scope for version one.
    expect(await canUploadStaffDocument(EMPLOYEE_USER, TARGET_STAFF, 'certification')).toBe(false);
  });

  it('leaves the existing rules for other document types', async () => {
    expect(await canUploadStaffDocument(HR_USER, TARGET_STAFF, 'bank_details')).toBe(true);
    expect(await canUploadStaffDocument(EMPLOYEE_USER, TARGET_STAFF, 'drivers_license')).toBe(true);
    expect(await canUploadStaffDocument(CUSTODIAN, TARGET_STAFF, 'bank_details')).toBe(false);
  });
});

describe('canApproveDocuments', () => {
  it('requires the dedicated edit permission to verify a certification', async () => {
    expect(await canApproveDocuments(CUSTODIAN, 'certification')).toBe(true);
    expect(await canApproveDocuments(HR_USER, 'certification')).toBe(false);
  });

  it('a create-only custodian cannot verify their own submission', async () => {
    grant({ [CUSTODIAN]: { [STAFF_TRAINING_CERTIFICATES_PERMISSION]: ['create'] } });
    expect(await canCreateTrainingCertificates(CUSTODIAN)).toBe(true);
    expect(await canApproveDocuments(CUSTODIAN, 'certification')).toBe(false);
  });

  it('keeps the sensitive-HR rule for other document types', async () => {
    expect(await canApproveDocuments(HR_USER, 'bank_details')).toBe(true);
    expect(await canApproveDocuments(HR_USER)).toBe(true);
    expect(await canApproveDocuments(CUSTODIAN, 'bank_details')).toBe(false);
  });
});

describe('canDeleteStaffDocument', () => {
  it('requires the dedicated delete permission for a certification', async () => {
    expect(await canDeleteStaffDocument(CUSTODIAN, TARGET_STAFF, 'certification')).toBe(true);
    expect(await canDeleteStaffDocument(HR_USER, TARGET_STAFF, 'certification')).toBe(false);
  });

  it('does not let an employee delete their own certificate', async () => {
    expect(await canDeleteStaffDocument(EMPLOYEE_USER, TARGET_STAFF, 'certification')).toBe(false);
  });

  it('requires HR edit for other document types', async () => {
    expect(await canDeleteStaffDocument(HR_USER, TARGET_STAFF, 'bank_details')).toBe(true);
    expect(await canDeleteStaffDocument(EMPLOYEE_USER, TARGET_STAFF, 'bank_details')).toBe(false);
    expect(await canDeleteStaffDocument(CUSTODIAN, TARGET_STAFF, 'bank_details')).toBe(false);
  });

  it('fails closed on a lookup error', async () => {
    userHasPermission.mockRejectedValue(new Error('down'));
    expect(await canDeleteStaffDocument(CUSTODIAN, TARGET_STAFF, 'certification')).toBe(false);
  });
});
