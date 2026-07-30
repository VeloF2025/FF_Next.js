/**
 * POST /api/staff-training-certificates-upload
 *
 * The route owns two resources that cannot be committed together: a VF Storage
 * object and a database transaction. The tests that matter here are the ordering
 * ones — nothing is uploaded before the caller is authorized and the file is
 * validated, and a failed transaction takes the uploaded object with it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';

const h = vi.hoisted(() => ({
  authUser: { current: { id: 'user-1', name: 'Custodian' } as { id: string; name?: string } | null },
  canCreate: vi.fn(),
  uploadStaffDocument: vi.fn(),
  deleteStaffDocument: vi.fn(),
  isVFStorageAvailable: vi.fn(),
  createSubmission: vi.fn(),
  transaction: vi.fn(),
  logDocumentUploaded: vi.fn(),
  logHsActivity: vi.fn(),
  errorLog: vi.fn(),
  fileBuffer: { current: Buffer.from('%PDF-1.4 hello') },
  parsedForm: {
    current: { fields: {} as Record<string, unknown>, files: {} as Record<string, unknown> },
  },
}));

vi.mock('@/lib/auth', () => ({
  withAuth:
    (handler: (req: unknown, res: unknown) => unknown) =>
    async (req: Record<string, unknown>, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
      if (!h.authUser.current) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      req.user = h.authUser.current;
      return handler(req, res);
    },
}));

vi.mock('@/lib/arcjet', () => ({ aj: {}, ajStrict: {}, withArcjetProtection: (fn: unknown) => fn }));
vi.mock('@/services/staff/staffAccessService', () => ({ canCreateTrainingCertificates: h.canCreate }));
vi.mock('@/services/vfStorageAdapter', () => ({
  uploadStaffDocument: h.uploadStaffDocument,
  deleteStaffDocument: h.deleteStaffDocument,
  isVFStorageAvailable: h.isVFStorageAvailable,
}));
vi.mock('@/lib/db-pool', () => ({ transaction: h.transaction }));
vi.mock('@/services/staff/staffAuditService', () => ({ logDocumentUploaded: h.logDocumentUploaded }));
vi.mock('@/modules/health-safety/services/activityLog', () => ({ logHsActivity: h.logHsActivity }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: h.errorLog, debug: vi.fn() }),
  log: { info: vi.fn(), warn: vi.fn(), error: h.errorLog, debug: vi.fn() },
}));
vi.mock('fs/promises', () => ({
  readFile: async () => h.fileBuffer.current,
  unlink: async () => undefined,
  default: { readFile: async () => h.fileBuffer.current, unlink: async () => undefined },
}));
vi.mock('formidable', () => ({
  default: () => ({
    parse: (
      _req: unknown,
      cb: (err: unknown, fields: unknown, files: unknown) => void
    ) => cb(null, h.parsedForm.current.fields, h.parsedForm.current.files),
  }),
}));

// Only the transactional writer is replaced; the rest of the service is real.
vi.mock('@/modules/health-safety/services/trainingCertificateService', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createTrainingCertificateSubmission: h.createSubmission };
});

// From the definition site, matching the route's import.
import { TrainingCertificateError } from '../services/trainingCertificateValidation';

const STAFF_ID = '11111111-1111-1111-1111-111111111111';
const HEIGHTS = '44444444-4444-4444-4444-444444444444';
const SPLICING = '55555555-5555-5555-5555-555555555555';
const UPLOADED = {
  success: true,
  filename: `${STAFF_ID}_cert.pdf`,
  path: 'staff/documents/cert.pdf',
  url: 'http://storage.internal/staff/documents/cert.pdf',
  size: 1024,
};

function file(overrides: Record<string, unknown> = {}) {
  return [
    {
      filepath: '/tmp/upload-1',
      originalFilename: 'cert.pdf',
      mimetype: 'application/pdf',
      size: 1024,
      ...overrides,
    },
  ];
}

function fields(overrides: Record<string, unknown> = {}) {
  return {
    staffId: [STAFF_ID],
    trainingTypeIds: [HEIGHTS],
    certificateNumber: ['CERT-001'],
    provider: ['Acme Training'],
    completedDate: ['2026-01-15'],
    ...overrides,
  };
}

async function post() {
  const mod = await import('@/pages/api/staff-training-certificates-upload');
  const { req, res } = createMocks({ method: 'POST' });
  await mod.default(req as never, res as never);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  // No resetModules: every mutable fixture lives on `h`, and reloading would
  // give the route a fresh TrainingCertificateError class, breaking instanceof.
  h.authUser.current = { id: 'user-1', name: 'Custodian' };
  h.canCreate.mockResolvedValue(true);
  h.isVFStorageAvailable.mockResolvedValue(true);
  h.uploadStaffDocument.mockResolvedValue(UPLOADED);
  h.deleteStaffDocument.mockResolvedValue(true);
  h.fileBuffer.current = Buffer.from('%PDF-1.4 hello');
  h.parsedForm.current = { fields: fields(), files: { file: file() } };
  h.createSubmission.mockResolvedValue({
    documentId: 'doc-1',
    trainingRecordIds: ['tr-1'],
    verificationStatus: 'pending',
  });
  h.transaction.mockImplementation(async (cb: (txn: unknown) => Promise<unknown>) =>
    cb({ query: vi.fn(), queryOne: vi.fn(), client: {} })
  );
});

describe('authorization comes before storage', () => {
  it('rejects an unauthenticated caller', async () => {
    h.authUser.current = null;
    const res = await post();
    expect(res._getStatusCode()).toBe(401);
    expect(h.uploadStaffDocument).not.toHaveBeenCalled();
  });

  it('rejects a caller without the create permission, before uploading', async () => {
    h.canCreate.mockResolvedValue(false);
    const res = await post();
    expect(res._getStatusCode()).toBe(403);
    expect(h.uploadStaffDocument).not.toHaveBeenCalled();
    expect(h.createSubmission).not.toHaveBeenCalled();
  });
});

describe('validation happens before anything is uploaded', () => {
  const cases: Array<[string, () => void]> = [
    ['no employee', () => { h.parsedForm.current.fields = fields({ staffId: undefined }); }],
    ['no training types', () => { h.parsedForm.current.fields = fields({ trainingTypeIds: undefined }); }],
    ['no completion date', () => { h.parsedForm.current.fields = fields({ completedDate: undefined }); }],
    ['no certificate number', () => { h.parsedForm.current.fields = fields({ certificateNumber: ['  '] }); }],
    ['no provider', () => { h.parsedForm.current.fields = fields({ provider: [''] }); }],
    ['no file', () => { h.parsedForm.current.files = {}; }],
    ['a repeated training type', () => {
      h.parsedForm.current.fields = fields({ trainingTypeIds: [HEIGHTS, HEIGHTS] });
    }],
    ['an expiry before completion', () => {
      h.parsedForm.current.fields = fields({ expiryDate: ['2025-12-31'] });
    }],
    ['an unsupported extension', () => {
      h.parsedForm.current.files = { file: file({ originalFilename: 'cert.exe', mimetype: 'application/x-msdownload' }) };
    }],
    ['a mime type that contradicts the extension', () => {
      h.parsedForm.current.files = { file: file({ mimetype: 'image/png' }) };
    }],
    ['contents that contradict the extension', () => {
      // Declared a PDF, but the bytes are a PNG.
      h.fileBuffer.current = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }],
    ['a file over 10 MB', () => {
      h.parsedForm.current.files = { file: file({ size: 10 * 1024 * 1024 + 1 }) };
    }],
    ['a malformed date', () => {
      h.parsedForm.current.fields = fields({ completedDate: ['15/01/2026'] });
    }],
  ];

  for (const [name, arrange] of cases) {
    it(`rejects ${name} with 400`, async () => {
      arrange();
      const res = await post();
      expect(res._getStatusCode()).toBe(400);
      expect(h.uploadStaffDocument).not.toHaveBeenCalled();
    });
  }
});

describe('storage availability', () => {
  it('returns 503 without attempting the upload', async () => {
    h.isVFStorageAvailable.mockResolvedValue(false);
    const res = await post();
    expect(res._getStatusCode()).toBe(503);
    expect(h.uploadStaffDocument).not.toHaveBeenCalled();
  });
});

describe('a successful submission', () => {
  it('creates one document and one linked row for a single competency', async () => {
    const res = await post();
    expect(res._getStatusCode()).toBe(201);
    expect(h.uploadStaffDocument).toHaveBeenCalledTimes(1);
    expect(h.uploadStaffDocument.mock.calls[0][3]).toBe('certification');
  });

  it('passes every selected competency through to one submission', async () => {
    h.parsedForm.current.fields = fields({ trainingTypeIds: [HEIGHTS, SPLICING] });
    h.createSubmission.mockResolvedValue({
      documentId: 'doc-1',
      trainingRecordIds: ['tr-1', 'tr-2'],
      verificationStatus: 'pending',
    });
    const res = await post();
    expect(res._getStatusCode()).toBe(201);
    expect(h.createSubmission).toHaveBeenCalledTimes(1);
    expect(h.createSubmission.mock.calls[0][1].trainingTypeIds).toEqual([HEIGHTS, SPLICING]);
    expect(h.uploadStaffDocument).toHaveBeenCalledTimes(1);
  });

  it('returns only ids and the pending status — never a storage location', async () => {
    const res = await post();
    const body = JSON.stringify(res._getData());
    expect(body).toContain('doc-1');
    expect(body).toContain('pending');
    expect(body).not.toContain('staff/documents/cert.pdf');
    expect(body).not.toContain('storage.internal');
    expect(body).not.toContain(UPLOADED.filename);
  });

  it('records the audit trail after the write commits', async () => {
    await post();
    expect(h.logDocumentUploaded).toHaveBeenCalled();
    expect(h.logHsActivity).toHaveBeenCalled();
    const activity = h.logHsActivity.mock.calls[0][0];
    expect(activity.metadata).toMatchObject({ verificationStatus: 'pending' });
    // Audit metadata carries ids and state, not the certificate's location.
    expect(JSON.stringify(activity)).not.toContain('staff/documents/cert.pdf');
    expect(JSON.stringify(activity)).not.toContain('storage.internal');
  });

  it('does not log the certificate number or provider', async () => {
    await post();
    const logged = JSON.stringify(h.errorLog.mock.calls);
    expect(logged).not.toContain('CERT-001');
  });
});

describe('compensation when the database half fails', () => {
  it('deletes the uploaded object', async () => {
    h.createSubmission.mockRejectedValue(new Error('constraint violated'));
    const res = await post();
    expect(res._getStatusCode()).toBe(500);
    expect(h.deleteStaffDocument).toHaveBeenCalledWith(STAFF_ID, UPLOADED.filename);
  });

  it('maps a duplicate certificate to 409 and still compensates', async () => {
    h.createSubmission.mockRejectedValue(
      new TrainingCertificateError('duplicate_certificate', 'already recorded')
    );
    const res = await post();
    expect(res._getStatusCode()).toBe(409);
    expect(h.deleteStaffDocument).toHaveBeenCalledWith(STAFF_ID, UPLOADED.filename);
  });

  it('maps an unknown employee to 404 and still compensates', async () => {
    h.createSubmission.mockRejectedValue(
      new TrainingCertificateError('unknown_staff', 'gone')
    );
    const res = await post();
    expect(res._getStatusCode()).toBe(404);
    expect(h.deleteStaffDocument).toHaveBeenCalledWith(STAFF_ID, UPLOADED.filename);
  });

  it('raises a cleanup alert when the compensating delete also fails', async () => {
    h.createSubmission.mockRejectedValue(new Error('constraint violated'));
    h.deleteStaffDocument.mockResolvedValue(false);
    const res = await post();
    expect(res._getStatusCode()).toBe(500);

    const alert = h.errorLog.mock.calls.find(([msg]: [string]) => /orphan/i.test(msg));
    expect(alert).toBeDefined();
    // The operator needs the filename to clean up; the browser must not get it.
    expect(JSON.stringify(alert)).toContain(UPLOADED.filename);
    expect(JSON.stringify(res._getData())).not.toContain(UPLOADED.filename);
  });

  it('does not record an audit entry for a submission that failed', async () => {
    h.createSubmission.mockRejectedValue(new Error('constraint violated'));
    await post();
    expect(h.logDocumentUploaded).not.toHaveBeenCalled();
    expect(h.logHsActivity).not.toHaveBeenCalled();
  });
});
