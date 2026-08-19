import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TxnClient } from '@/lib/db-pool';

const db = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ transaction: db.transaction }));

const repo = vi.hoisted(() => ({ insertIncidentEvidence: vi.fn(), insertIncidentAction: vi.fn() }));
vi.mock('../incidentRepository', async () => {
  const actual = await vi.importActual<typeof import('../incidentRepository')>('../incidentRepository');
  return { ...actual, insertIncidentEvidence: repo.insertIncidentEvidence, insertIncidentAction: repo.insertIncidentAction };
});

const queries = vi.hoisted(() => ({ getIncidentCore: vi.fn() }));
vi.mock('../reviewQueries', () => queries);

const scope = vi.hoisted(() => ({ resolveIncidentScope: vi.fn(), isProjectOwnedByScope: vi.fn() }));
vi.mock('../reviewScope', () => scope);

const storage = vi.hoisted(() => ({ uploadCategorizedFile: vi.fn() }));
vi.mock('@/lib/vfStorageUpload', async () => {
  const actual = await vi.importActual<typeof import('@/lib/vfStorageUpload')>('@/lib/vfStorageUpload');
  return { ...actual, uploadCategorizedFile: storage.uploadCategorizedFile };
});

const logger = vi.hoisted(() => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/logger', () => logger);

import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  IncidentEvidenceAccessDeniedError,
  IncidentEvidenceConflictError,
  IncidentEvidenceOrphanError,
  IncidentEvidenceValidationError,
  MAX_EVIDENCE_BYTES,
  addIncidentEvidence,
  type AddIncidentEvidenceRequest,
  type IncidentEvidenceViewer,
} from '../evidenceService';
import { IncidentNotFoundError } from '../incidentRepository';
import { SIGNATURE_REGISTERED_TYPES, VfStorageOriginError, VfStorageValidationError } from '@/lib/vfStorageUpload';

const INCIDENT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';
const PROJECT = '44444444-4444-4444-8444-444444444444';

const UPLOADED = { url: '/storage/fleet/incidents/key.jpg', key: 'fleet/incidents/key.jpg' };

function baseRequest(overrides: Partial<AddIncidentEvidenceRequest> = {}): AddIncidentEvidenceRequest {
  return {
    incidentId: INCIDENT, actorUserId: USER, evidenceType: 'photo', mimeType: 'image/jpeg',
    base64: 'aW1hZ2U=', filename: 'evidence.jpg', description: null, requestCorrelationId: null,
    ...overrides,
  };
}
const viewer: IncidentEvidenceViewer = { userId: USER, staffId: STAFF, role: 'manager' };
const unrestrictedScope = { unrestricted: true, pmUserId: USER, pmStaffId: STAFF };

function coreRecord(overrides: Record<string, unknown> = {}) {
  return { id: INCIDENT, lifecycleStatus: 'open', projectId: PROJECT, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.mockImplementation(async (cb: (txn: TxnClient) => unknown) => cb({} as TxnClient));
  scope.resolveIncidentScope.mockResolvedValue(unrestrictedScope);
  scope.isProjectOwnedByScope.mockResolvedValue(true);
  queries.getIncidentCore.mockResolvedValue(coreRecord());
  storage.uploadCategorizedFile.mockResolvedValue(UPLOADED);
  repo.insertIncidentEvidence.mockResolvedValue({
    id: 'evidence-1', evidenceType: 'photo', storageUrl: UPLOADED.url, storageKey: UPLOADED.key,
    mimeType: 'image/jpeg', originalFilename: 'evidence.jpg', uploadedBy: USER, description: null,
    createdAt: '2026-08-13T08:00:00.000Z',
  });
  repo.insertIncidentAction.mockResolvedValue({ id: 'action-1' });
});

describe('authorization and scope', () => {
  it('rejects an unsupported evidenceType before any lookup', async () => {
    await expect(addIncidentEvidence(baseRequest({ evidenceType: 'manager_note' as never }), viewer))
      .rejects.toBeInstanceOf(IncidentEvidenceValidationError);
    expect(scope.resolveIncidentScope).not.toHaveBeenCalled();
  });

  it('rejects when the viewer lacks fleet.incidents edit access', async () => {
    scope.resolveIncidentScope.mockResolvedValue(null);
    await expect(addIncidentEvidence(baseRequest(), viewer)).rejects.toBeInstanceOf(IncidentEvidenceAccessDeniedError);
    expect(storage.uploadCategorizedFile).not.toHaveBeenCalled();
  });

  it('rejects an incident that does not exist', async () => {
    queries.getIncidentCore.mockResolvedValue(null);
    await expect(addIncidentEvidence(baseRequest(), viewer)).rejects.toBeInstanceOf(IncidentNotFoundError);
    expect(storage.uploadCategorizedFile).not.toHaveBeenCalled();
  });

  it('rejects a restricted PM outside their project scope (cross-scope)', async () => {
    scope.resolveIncidentScope.mockResolvedValue({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF });
    scope.isProjectOwnedByScope.mockResolvedValue(false);
    await expect(addIncidentEvidence(baseRequest(), viewer)).rejects.toBeInstanceOf(IncidentEvidenceAccessDeniedError);
    expect(storage.uploadCategorizedFile).not.toHaveBeenCalled();
  });

  it('rejects evidence on an already-closed incident before uploading (terminal misuse)', async () => {
    queries.getIncidentCore.mockResolvedValue(coreRecord({ lifecycleStatus: 'resolved' }));
    await expect(addIncidentEvidence(baseRequest(), viewer)).rejects.toBeInstanceOf(IncidentEvidenceConflictError);
    expect(storage.uploadCategorizedFile).not.toHaveBeenCalled();
  });
});

describe('upload ordering and key generation', () => {
  it('uploads only after authorization, scope, and lifecycle checks pass, using the configured MIME/size allowlist', async () => {
    await addIncidentEvidence(baseRequest(), viewer);
    expect(scope.resolveIncidentScope).toHaveBeenCalled();
    expect(queries.getIncidentCore).toHaveBeenCalled();
    expect(storage.uploadCategorizedFile).toHaveBeenCalledWith(expect.objectContaining({
      category: 'fleet/incidents', mimeType: 'image/jpeg',
      allowedMimeTypes: ALLOWED_EVIDENCE_MIME_TYPES, maxBytes: MAX_EVIDENCE_BYTES,
    }));
  });

  it('generates the storage key from the incident ID plus a random UUID, never any component of the original filename or path', async () => {
    await addIncidentEvidence(baseRequest({ filename: '../../etc/passwd-secret.jpg' }), viewer);
    const call = storage.uploadCategorizedFile.mock.calls[0][0];
    expect(call.storageFilename.startsWith(`${INCIDENT}-`)).toBe(true);
    expect(call.storageFilename).not.toContain('passwd');
    expect(call.storageFilename).not.toContain('etc');
    expect(call.storageFilename).not.toContain('secret');
  });

  it('generates a different random storage key on every call for the same incident', async () => {
    await addIncidentEvidence(baseRequest(), viewer);
    await addIncidentEvidence(baseRequest(), viewer);
    const [firstCall, secondCall] = storage.uploadCategorizedFile.mock.calls;
    expect(firstCall[0].storageFilename).not.toBe(secondCall[0].storageFilename);
  });

  it('propagates a VF Storage validation failure (disallowed MIME, oversized, invalid base64) without writing rows', async () => {
    storage.uploadCategorizedFile.mockRejectedValue(new VfStorageValidationError('MIME type not allowed'));
    await expect(addIncidentEvidence(baseRequest(), viewer)).rejects.toBeInstanceOf(VfStorageValidationError);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(repo.insertIncidentEvidence).not.toHaveBeenCalled();
  });

  it('propagates a non-approved returned origin without writing rows', async () => {
    storage.uploadCategorizedFile.mockRejectedValue(new VfStorageOriginError('unapproved origin'));
    await expect(addIncidentEvidence(baseRequest(), viewer)).rejects.toBeInstanceOf(VfStorageOriginError);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe('transactional evidence + action write', () => {
  it('inserts the evidence row and the evidence_added action in one transaction', async () => {
    const result = await addIncidentEvidence(baseRequest(), viewer);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(repo.insertIncidentEvidence).toHaveBeenCalledWith(expect.objectContaining({
      incidentId: INCIDENT, storageUrl: UPLOADED.url, storageKey: UPLOADED.key, originalFilename: 'evidence.jpg',
    }), expect.anything());
    expect(repo.insertIncidentAction).toHaveBeenCalledWith(expect.objectContaining({
      incidentId: INCIDENT, actionType: 'evidence_added', actorUserId: USER, isSystemActor: false,
    }), expect.anything());
    expect(result).toEqual({ evidence: expect.objectContaining({ id: 'evidence-1' }), actionId: 'action-1' });
  });

  it('sanitizes the display filename separately from the generated storage key', async () => {
    await addIncidentEvidence(baseRequest({ filename: '../../evil <script>.jpg' }), viewer);
    const evidenceArgs = repo.insertIncidentEvidence.mock.calls[0][0];
    expect(evidenceArgs.originalFilename).not.toContain('..');
    expect(evidenceArgs.originalFilename).not.toContain('<');
    expect(evidenceArgs.originalFilename).not.toContain('/');
  });

  it('stores a null display filename when none was provided, without inventing one', async () => {
    await addIncidentEvidence(baseRequest({ filename: null }), viewer);
    const evidenceArgs = repo.insertIncidentEvidence.mock.calls[0][0];
    expect(evidenceArgs.originalFilename).toBeNull();
  });

  it('never logs base64 file content', async () => {
    await addIncidentEvidence(baseRequest(), viewer);
    for (const call of logger.log.error.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('aW1hZ2U=');
    }
  });
});

describe('orphan cleanup on post-upload database failure', () => {
  it('records a structured orphan-cleanup reference including the storage key when the DB write fails after a successful upload', async () => {
    db.transaction.mockRejectedValue(new Error('connection lost'));
    await expect(addIncidentEvidence(baseRequest(), viewer)).rejects.toBeInstanceOf(IncidentEvidenceOrphanError);
    expect(logger.log.error).toHaveBeenCalledWith(
      expect.stringContaining('orphan'),
      expect.objectContaining({ incidentId: INCIDENT, storageKey: UPLOADED.key, storageUrl: UPLOADED.url }),
      expect.any(String),
    );
  });

  it('exposes the storage key/url on the thrown orphan error so it can be reconciled later', async () => {
    db.transaction.mockRejectedValue(new Error('insert failed'));
    let caught: unknown;
    try {
      await addIncidentEvidence(baseRequest(), viewer);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IncidentEvidenceOrphanError);
    const orphan = caught as IncidentEvidenceOrphanError;
    expect(orphan.storageKey).toBe(UPLOADED.key);
    expect(orphan.storageUrl).toBe(UPLOADED.url);
  });
});

describe('isolation from acknowledgement and emergency notification delivery', () => {
  it('never mutates incident rows or reaches the transaction when the upload fails — evidence is a fully separate write path from acknowledgement/escalation', async () => {
    // Acknowledgement runs through reviewTransitions.runAcknowledged and escalation/opened
    // notifications run through incidentNotifications — neither is imported here, and this
    // module never calls incidentRepository.acknowledgeIncident. A photo/upload failure
    // therefore cannot block those flows: it fails before this module's own transaction is
    // ever entered, so nothing about the incident's lifecycle state is touched.
    storage.uploadCategorizedFile.mockRejectedValue(new VfStorageValidationError('file too large'));
    await expect(addIncidentEvidence(baseRequest(), viewer)).rejects.toBeInstanceOf(VfStorageValidationError);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(repo.insertIncidentAction).not.toHaveBeenCalled();
    expect(repo.insertIncidentEvidence).not.toHaveBeenCalled();
  });

  it('never allows a MIME type the uploader has no signature for', () => {
    // ALLOWED_EVIDENCE_MIME_TYPES and the uploader's MIME_SIGNATURES are declared in different
    // modules with nothing tying them together. Signature verification fails closed, so adding
    // a type here without a matching signature would reject every upload of it at runtime and
    // surface only as a confused user. This is that tie.
    for (const mimeType of ALLOWED_EVIDENCE_MIME_TYPES) {
      expect(SIGNATURE_REGISTERED_TYPES).toContain(mimeType);
    }
  });
});
