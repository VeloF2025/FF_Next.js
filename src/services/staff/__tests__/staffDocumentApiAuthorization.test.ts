/**
 * Every direct staff-document endpoint must authorize, not merely authenticate.
 *
 * Before this, five of the six only checked that *someone* was logged in:
 * `/api/staff-documents-download` streamed any document's bytes to any signed-in
 * user who knew an id, `/api/staff-documents/[documentId]` read, updated and
 * deleted any document, `/api/staff-documents/expiring` dumped every employee's
 * documents including `file_path`, and `/api/staff-documents-upload` accepted a
 * document for any employee. Only the per-staff list checked anything.
 *
 * The assertions that matter are negative: an unauthorized caller must not reach
 * the database, VF Storage, or the audit log.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';

const h = vi.hoisted(() => ({
  authUser: { current: null as { id: string; name?: string } | null },
  sqlRows: { current: [] as Record<string, unknown>[] },
  sqlCalls: { current: [] as string[] },
  canAccessStaffDocuments: vi.fn(),
  canAccessStaffDocument: vi.fn(),
  canUploadStaffDocument: vi.fn(),
  canDeleteStaffDocument: vi.fn(),
  canApproveDocuments: vi.fn(),
  canAccessTrainingCertificates: vi.fn(),
  deleteStaffDocument: vi.fn(),
  parsedForm: { current: { fields: {} as Record<string, unknown>, files: {} as Record<string, unknown> } },
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

vi.mock('@/lib/arcjet', () => ({
  aj: {},
  ajStrict: {},
  withArcjetProtection: (handler: unknown) => handler,
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: () => {
    const fn = (strings: TemplateStringsArray | string, ...values: unknown[]) => {
      const text = typeof strings === 'string' ? strings : strings.join(' ? ');
      h.sqlCalls.current.push(text);
      void values;
      return Promise.resolve(h.sqlRows.current);
    };
    (fn as unknown as { unsafe: (r: string) => string }).unsafe = (r: string) => r;
    return fn;
  },
  neonConfig: {},
}));

vi.mock('@/services/staff/staffAccessService', () => ({
  canAccessStaffDocuments: h.canAccessStaffDocuments,
  canAccessStaffDocument: h.canAccessStaffDocument,
  canUploadStaffDocument: h.canUploadStaffDocument,
  canDeleteStaffDocument: h.canDeleteStaffDocument,
  canApproveDocuments: h.canApproveDocuments,
  canAccessTrainingCertificates: h.canAccessTrainingCertificates,
  canAccessSensitiveStaffData: h.canAccessStaffDocuments,
  getStaffIdForUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/staff/staffAuditService', () => ({
  logDocumentDownloaded: vi.fn(),
  logDocumentUploaded: vi.fn(),
  logDocumentVerified: vi.fn(),
  logDocumentRejected: vi.fn(),
  logDocumentDeleted: vi.fn(),
  logDocumentRevoked: vi.fn(),
}));

vi.mock('@/services/vfStorageAdapter', () => ({
  deleteStaffDocument: h.deleteStaffDocument,
  uploadStaffDocument: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('formidable', () => ({
  default: () => ({
    parse: (
      _req: unknown,
      cb: (err: unknown, fields: unknown, files: unknown) => void
    ) => cb(null, h.parsedForm.current.fields, h.parsedForm.current.files),
  }),
}));

const STAFF_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_STAFF = '99999999-9999-9999-9999-999999999999';
const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222';

const CERT_ROW = {
  id: DOCUMENT_ID,
  staff_id: STAFF_ID,
  document_type: 'certification',
  document_name: 'cert.pdf',
  file_name: 'cert.pdf',
  file_path: 'staff/documents/cert.pdf',
  file_url: 'http://storage.internal/staff/documents/cert.pdf',
  mime_type: 'application/pdf',
  verification_status: 'pending',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function denyAll(): void {
  h.canAccessStaffDocuments.mockResolvedValue(false);
  h.canAccessStaffDocument.mockResolvedValue(false);
  h.canUploadStaffDocument.mockResolvedValue(false);
  h.canDeleteStaffDocument.mockResolvedValue(false);
  h.canApproveDocuments.mockResolvedValue(false);
  h.canAccessTrainingCertificates.mockResolvedValue(false);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  h.authUser.current = { id: 'user-1', name: 'Test User' };
  h.sqlRows.current = [CERT_ROW];
  h.sqlCalls.current = [];
  h.parsedForm.current = { fields: {}, files: {} };
  denyAll();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(8),
  }) as unknown as typeof fetch;
});

async function callRoute(modulePath: string, options: Parameters<typeof createMocks>[0]) {
  const mod = await import(modulePath);
  const { req, res } = createMocks(options);
  await mod.default(req as never, res as never);
  return res;
}

describe('unauthenticated callers are rejected before anything is read', () => {
  const routes: Array<[string, string, Parameters<typeof createMocks>[0]]> = [
    ['download', '@/pages/api/staff-documents-download', { method: 'GET', query: { documentId: DOCUMENT_ID } }],
    ['detail', '@/pages/api/staff-documents/[documentId]', { method: 'GET', query: { documentId: DOCUMENT_ID } }],
    ['delete', '@/pages/api/staff-documents/[documentId]', { method: 'DELETE', query: { documentId: DOCUMENT_ID } }],
    ['expiring', '@/pages/api/staff-documents/expiring', { method: 'GET', query: {} }],
    ['list', '@/pages/api/staff/[staffId]/documents', { method: 'GET', query: { staffId: STAFF_ID } }],
    ['verify', '@/pages/api/staff-documents/[documentId]/verify', { method: 'POST', query: { documentId: DOCUMENT_ID }, body: { status: 'verified' } }],
    ['upload', '@/pages/api/staff-documents-upload', { method: 'POST' }],
  ];

  for (const [name, modulePath, options] of routes) {
    it(`${name} returns 401`, async () => {
      h.authUser.current = null;
      const res = await callRoute(modulePath, options);
      expect(res._getStatusCode()).toBe(401);
      expect(h.sqlCalls.current).toHaveLength(0);
    });
  }
});

describe('authenticated but unauthorized callers get 403 and no data', () => {
  it('download does not fetch the file', async () => {
    const res = await callRoute('@/pages/api/staff-documents-download', {
      method: 'GET',
      query: { documentId: DOCUMENT_ID },
    });
    expect(res._getStatusCode()).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('detail does not return the document', async () => {
    const res = await callRoute('@/pages/api/staff-documents/[documentId]', {
      method: 'GET',
      query: { documentId: DOCUMENT_ID },
    });
    expect(res._getStatusCode()).toBe(403);
    expect(JSON.stringify(res._getData())).not.toContain('staff/documents/cert.pdf');
  });

  it('update does not write', async () => {
    const res = await callRoute('@/pages/api/staff-documents/[documentId]', {
      method: 'PUT',
      query: { documentId: DOCUMENT_ID },
      body: { documentName: 'renamed' },
    });
    expect(res._getStatusCode()).toBe(403);
    expect(h.sqlCalls.current.some((q) => q.includes('UPDATE staff_documents'))).toBe(false);
  });

  it('delete removes neither the row nor the stored object', async () => {
    const res = await callRoute('@/pages/api/staff-documents/[documentId]', {
      method: 'DELETE',
      query: { documentId: DOCUMENT_ID },
    });
    expect(res._getStatusCode()).toBe(403);
    expect(h.deleteStaffDocument).not.toHaveBeenCalled();
    expect(h.sqlCalls.current.some((q) => q.includes('DELETE FROM staff_documents'))).toBe(false);
  });

  it('verify does not change the verification status', async () => {
    const res = await callRoute('@/pages/api/staff-documents/[documentId]/verify', {
      method: 'POST',
      query: { documentId: DOCUMENT_ID },
      body: { status: 'verified' },
    });
    expect(res._getStatusCode()).toBe(403);
    expect(h.sqlCalls.current.some((q) => q.includes('UPDATE staff_documents'))).toBe(false);
  });

  it('expiring returns nothing at all', async () => {
    const res = await callRoute('@/pages/api/staff-documents/expiring', { method: 'GET', query: {} });
    expect(res._getStatusCode()).toBe(403);
    expect(JSON.stringify(res._getData())).not.toContain('staff/documents/cert.pdf');
  });

  it('upload does not accept a document for another employee', async () => {
    h.parsedForm.current = {
      fields: { staffId: [OTHER_STAFF], documentType: ['certification'], documentName: ['cert.pdf'] },
      files: {},
    };
    const res = await callRoute('@/pages/api/staff-documents-upload', { method: 'POST' });
    expect(res._getStatusCode()).toBe(403);
    expect(h.sqlCalls.current.some((q) => q.includes('INSERT INTO staff_documents'))).toBe(false);
  });
});

describe('a certification has exactly one way in', () => {
  it('the generic upload route refuses it and names the certificate flow', async () => {
    // Permitted caller — this is a routing rule, not an authorization one.
    h.canUploadStaffDocument.mockResolvedValue(true);
    h.parsedForm.current = {
      fields: { staffId: [STAFF_ID], documentType: ['certification'], documentName: ['cert.pdf'] },
      files: {},
    };

    const res = await callRoute('@/pages/api/staff-documents-upload', { method: 'POST' });

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.stringify(res._getData())).toContain('/health-safety/training/certificates/new');
    // An orphan here could never be verified (the lifecycle rejects a
    // submission with no linked rows) yet would still occupy the unique
    // (employee, number, provider) slot and block the real upload.
    expect(h.sqlCalls.current.some((q) => q.includes('INSERT INTO staff_documents'))).toBe(false);
  });

  it('still accepts every other document type', async () => {
    h.canUploadStaffDocument.mockResolvedValue(true);
    h.parsedForm.current = {
      fields: { staffId: [STAFF_ID], documentType: ['bank_details'], documentName: ['bank.pdf'] },
      files: {},
    };

    const res = await callRoute('@/pages/api/staff-documents-upload', { method: 'POST' });

    // Rejected later for having no file — but NOT by the certification guard.
    expect(JSON.stringify(res._getData())).not.toContain('/health-safety/training/certificates/new');
  });
});

describe('authorization is decided from the stored document, not the request', () => {
  it('download resolves the document owner and type server-side', async () => {
    h.canAccessStaffDocument.mockResolvedValue(true);
    await callRoute('@/pages/api/staff-documents-download', {
      method: 'GET',
      // A caller-supplied staffId must not be what gets authorized.
      query: { documentId: DOCUMENT_ID, staffId: OTHER_STAFF },
    });
    expect(h.canAccessStaffDocument).toHaveBeenCalledWith('user-1', STAFF_ID, 'certification');
  });

  it('delete authorizes against the stored type', async () => {
    h.canDeleteStaffDocument.mockResolvedValue(true);
    await callRoute('@/pages/api/staff-documents/[documentId]', {
      method: 'DELETE',
      query: { documentId: DOCUMENT_ID },
    });
    expect(h.canDeleteStaffDocument).toHaveBeenCalledWith('user-1', STAFF_ID, 'certification');
  });

  it('verify authorizes against the stored type', async () => {
    h.canApproveDocuments.mockResolvedValue(true);
    await callRoute('@/pages/api/staff-documents/[documentId]/verify', {
      method: 'POST',
      query: { documentId: DOCUMENT_ID },
      body: { status: 'verified' },
    });
    expect(h.canApproveDocuments).toHaveBeenCalledWith('user-1', 'certification');
  });
});

describe('the create/verify split holds at the route boundary', () => {
  it('a create-only custodian may upload but not verify', async () => {
    h.canUploadStaffDocument.mockResolvedValue(true);
    h.canApproveDocuments.mockResolvedValue(false);

    const verify = await callRoute('@/pages/api/staff-documents/[documentId]/verify', {
      method: 'POST',
      query: { documentId: DOCUMENT_ID },
      body: { status: 'verified' },
    });
    expect(verify._getStatusCode()).toBe(403);
  });

  it('an H&S reader without the certificate grant cannot download the binary', async () => {
    h.canAccessStaffDocuments.mockResolvedValue(false);
    h.canAccessStaffDocument.mockResolvedValue(false);
    const res = await callRoute('@/pages/api/staff-documents-download', {
      method: 'GET',
      query: { documentId: DOCUMENT_ID },
    });
    expect(res._getStatusCode()).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('responses never carry a storage location', () => {
  it('the detail response omits file_path and file_url', async () => {
    h.canAccessStaffDocument.mockResolvedValue(true);
    const res = await callRoute('@/pages/api/staff-documents/[documentId]', {
      method: 'GET',
      query: { documentId: DOCUMENT_ID },
    });
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.stringify(res._getData());
    expect(body).not.toContain('staff/documents/cert.pdf');
    expect(body).not.toContain('storage.internal');
    expect(body).toContain('/api/staff-documents-download?documentId=');
  });

  it('the per-staff list omits file_path and file_url', async () => {
    h.canAccessStaffDocuments.mockResolvedValue(true);
    const res = await callRoute('@/pages/api/staff/[staffId]/documents', {
      method: 'GET',
      query: { staffId: STAFF_ID },
    });
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.stringify(res._getData());
    expect(body).not.toContain('staff/documents/cert.pdf');
    expect(body).not.toContain('storage.internal');
  });

  it('the expiring list omits file_path and file_url', async () => {
    h.canAccessStaffDocuments.mockResolvedValue(true);
    h.sqlRows.current = [{ ...CERT_ROW, expiry_date: '2026-12-31' }];
    const res = await callRoute('@/pages/api/staff-documents/expiring', { method: 'GET', query: {} });
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.stringify(res._getData());
    expect(body).not.toContain('staff/documents/cert.pdf');
    expect(body).not.toContain('storage.internal');
  });

  it('a certificate-only reader sees certification documents and nothing else', async () => {
    h.canAccessStaffDocuments.mockResolvedValue(false);
    h.canAccessTrainingCertificates.mockResolvedValue(true);
    h.sqlRows.current = [{ ...CERT_ROW, expiry_date: '2026-12-31' }];
    const res = await callRoute('@/pages/api/staff-documents/expiring', { method: 'GET', query: {} });
    expect(res._getStatusCode()).toBe(200);
    expect(h.sqlCalls.current.some((q) => q.includes("document_type = 'certification'"))).toBe(true);
  });
});
