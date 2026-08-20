import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ transaction: db.transaction }));

const driverInputRepo = vi.hoisted(() => ({ lockIncidentForDriver: vi.fn(), findCurrentInputRequest: vi.fn() }));
vi.mock('../driverInputRepository', () => driverInputRepo);

const incidentService = vi.hoisted(() => ({ computeResponseEligibility: vi.fn() }));
vi.mock('../driverIncidentService', () => incidentService);

const settingsRepo = vi.hoisted(() => ({ getEffectiveDriverInputSettings: vi.fn() }));
vi.mock('../settingsRepository', () => settingsRepo);

const storage = vi.hoisted(() => ({ uploadCategorizedFile: vi.fn() }));
vi.mock('@/lib/vfStorageUpload', async () => {
  const actual = await vi.importActual<typeof import('@/lib/vfStorageUpload')>('@/lib/vfStorageUpload');
  return { ...actual, uploadCategorizedFile: storage.uploadCategorizedFile };
});

const logger = vi.hoisted(() => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/logger', () => logger);

import {
  DriverEvidenceNotEligibleError,
  DriverEvidenceOrphanError,
  DriverEvidenceValidationError,
  uploadDriverIncidentEvidence,
  type UploadDriverEvidenceCommand,
} from '../driverEvidenceService';
import { IncidentNotFoundError } from '../../incidentRepository';
import { SIGNATURE_REGISTERED_TYPES, VfStorageOriginError, VfStorageValidationError } from '@/lib/vfStorageUpload';

const INCIDENT = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const OTHER_STAFF = '99999999-9999-4999-8999-999999999999';

const UPLOADED = { url: '/storage/fleet/incidents/key.jpg', key: 'fleet/incidents/key.jpg' };
const BASE64 = 'aW1hZ2U=';

// Mirrors migration 506's `fleet_incident_driver_input_settings` seed
// (`evidence_allowed_mime_types` default) — see `scripts/migrations/sql/506_fleet_incident_driver_input.sql`.
const DEFAULT_EVIDENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

function settingsRow(overrides: Record<string, unknown> = {}) {
  return {
    version: 1, effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
    responseWindowWorkdays: 2, postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    recentWindowDays: 90, historyWindowDays: 365,
    enabledConcernCategories: ['assignment_error', 'site_error', 'vehicle_error', 'geofence_error', 'other'],
    evidenceAllowedMimeTypes: DEFAULT_EVIDENCE_MIME_TYPES, evidenceMaxBytes: 15728640,
    driverInputRequestedChannels: { inApp: true, email: true, whatsapp: false },
    driverResponseReceivedChannels: { inApp: true, email: true, whatsapp: false },
    ...overrides,
  };
}

function baseCommand(overrides: Partial<UploadDriverEvidenceCommand> = {}): UploadDriverEvidenceCommand {
  return { incidentId: INCIDENT, mimeType: 'image/jpeg', base64: BASE64, filename: 'evidence.jpg', description: null, ...overrides };
}

const lockedIncident = { id: INCIDENT, staffId: STAFF, lifecycleStatus: 'open', terminalAt: null };

let insertTxn: { queryOne: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  insertTxn = {
    queryOne: vi.fn().mockResolvedValue({ id: 'evidence-1', storage_url: UPLOADED.url }),
    query: vi.fn().mockResolvedValue([]),
  };
  db.transaction.mockImplementation(async (cb: (txn: unknown) => unknown) => cb(insertTxn));
  driverInputRepo.lockIncidentForDriver.mockResolvedValue(lockedIncident);
  driverInputRepo.findCurrentInputRequest.mockResolvedValue(null);
  incidentService.computeResponseEligibility.mockReturnValue({ eligible: true, reason: null });
  settingsRepo.getEffectiveDriverInputSettings.mockResolvedValue(settingsRow());
  storage.uploadCategorizedFile.mockResolvedValue(UPLOADED);
});

describe('authorization and scope', () => {
  it('rejects an incidentId that is not a valid UUID before touching the database', async () => {
    await expect(uploadDriverIncidentEvidence(baseCommand({ incidentId: 'not-a-uuid' }), STAFF))
      .rejects.toBeInstanceOf(DriverEvidenceValidationError);
    expect(driverInputRepo.lockIncidentForDriver).not.toHaveBeenCalled();
  });

  it('rejects an incident owned by another driver — indistinguishable from a missing incident', async () => {
    driverInputRepo.lockIncidentForDriver.mockResolvedValue(null);
    await expect(uploadDriverIncidentEvidence(baseCommand(), OTHER_STAFF)).rejects.toBeInstanceOf(IncidentNotFoundError);
    expect(storage.uploadCategorizedFile).not.toHaveBeenCalled();
  });

  it('scopes the lock to the caller session staff id, never a body-supplied id', async () => {
    await uploadDriverIncidentEvidence(baseCommand(), STAFF);
    expect(driverInputRepo.lockIncidentForDriver).toHaveBeenCalledWith(STAFF, INCIDENT, expect.anything());
  });

  it('rejects when response eligibility is closed, before uploading', async () => {
    incidentService.computeResponseEligibility.mockReturnValue({ eligible: false, reason: 'closed' });
    const error = await uploadDriverIncidentEvidence(baseCommand(), STAFF).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DriverEvidenceNotEligibleError);
    expect((error as DriverEvidenceNotEligibleError).reason).toBe('closed');
    expect(storage.uploadCategorizedFile).not.toHaveBeenCalled();
  });

  it('rejects when response eligibility is expired, before uploading', async () => {
    incidentService.computeResponseEligibility.mockReturnValue({ eligible: false, reason: 'expired' });
    const error = await uploadDriverIncidentEvidence(baseCommand(), STAFF).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DriverEvidenceNotEligibleError);
    expect((error as DriverEvidenceNotEligibleError).reason).toBe('expired');
    expect(storage.uploadCategorizedFile).not.toHaveBeenCalled();
  });

  it('authorizes (lock + eligibility) strictly before uploading — never uploads then checks', async () => {
    await uploadDriverIncidentEvidence(baseCommand(), STAFF);
    const lockOrder = driverInputRepo.lockIncidentForDriver.mock.invocationCallOrder[0];
    const uploadOrder = storage.uploadCategorizedFile.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(uploadOrder);
  });
});

describe('configured MIME/byte limits', () => {
  it('uploads using the effective settings allowlist and byte cap, not a hardcoded one', async () => {
    settingsRepo.getEffectiveDriverInputSettings.mockResolvedValue(settingsRow({ evidenceAllowedMimeTypes: ['image/png'], evidenceMaxBytes: 999 }));
    await uploadDriverIncidentEvidence(baseCommand({ mimeType: 'image/png' }), STAFF);
    expect(storage.uploadCategorizedFile).toHaveBeenCalledWith(expect.objectContaining({
      category: 'fleet/incidents', allowedMimeTypes: ['image/png'], maxBytes: 999,
    }));
  });

  it('propagates a malformed-base64 rejection from the uploader without writing any row', async () => {
    storage.uploadCategorizedFile.mockRejectedValue(new VfStorageValidationError('File content is not valid base64'));
    await expect(uploadDriverIncidentEvidence(baseCommand({ base64: '***not-base64***' }), STAFF)).rejects.toBeInstanceOf(VfStorageValidationError);
    expect(db.transaction).toHaveBeenCalledTimes(1); // only the authorization/eligibility transaction ran
    expect(insertTxn.queryOne).not.toHaveBeenCalled();
  });

  it('propagates a disallowed-MIME rejection from the uploader without writing any row', async () => {
    storage.uploadCategorizedFile.mockRejectedValue(new VfStorageValidationError('MIME type not allowed'));
    await expect(uploadDriverIncidentEvidence(baseCommand({ mimeType: 'application/zip' }), STAFF)).rejects.toBeInstanceOf(VfStorageValidationError);
    expect(insertTxn.queryOne).not.toHaveBeenCalled();
  });

  it('propagates an oversized-file rejection from the uploader without writing any row', async () => {
    storage.uploadCategorizedFile.mockRejectedValue(new VfStorageValidationError('File exceeds the maximum size'));
    await expect(uploadDriverIncidentEvidence(baseCommand(), STAFF)).rejects.toBeInstanceOf(VfStorageValidationError);
    expect(insertTxn.queryOne).not.toHaveBeenCalled();
  });

  it('propagates a non-approved returned storage origin without writing any row', async () => {
    storage.uploadCategorizedFile.mockRejectedValue(new VfStorageOriginError('unapproved origin'));
    await expect(uploadDriverIncidentEvidence(baseCommand(), STAFF)).rejects.toBeInstanceOf(VfStorageOriginError);
    expect(insertTxn.queryOne).not.toHaveBeenCalled();
  });

  it('every mime type the MIGRATION seeds has a registered content-signature — otherwise every upload of it fails closed at runtime', () => {
    // Read the seeded default out of the migration itself rather than asserting against the
    // fixture above. A hardcoded copy only proves the copy is consistent: adding image/heic
    // to the migration's DEFAULT would leave this green while every HEIC upload was rejected
    // by the fail-closed signature check, surfacing only as a confused driver.
    const migration = readFileSync(
      resolve(process.cwd(), 'scripts/migrations/sql/506_fleet_incident_driver_input.sql'), 'utf8');
    const seeded = migration.match(/evidence_allowed_mime_types TEXT\[\] NOT NULL DEFAULT ARRAY\[([^\]]*)\]/i);
    expect(seeded).not.toBeNull();
    const types = seeded![1]!.split(',').map((entry) => entry.trim().replace(/^'|'$/g, '')).filter(Boolean);
    expect(types.length).toBeGreaterThan(0);
    for (const mimeType of types) {
      expect(SIGNATURE_REGISTERED_TYPES).toContain(mimeType);
    }
  });
});

describe('storage key generation and filename sanitization', () => {
  it('generates the storage key from the incident ID plus a random UUID, never any component of the filename', async () => {
    await uploadDriverIncidentEvidence(baseCommand({ filename: '../../etc/passwd-secret.jpg' }), STAFF);
    const call = storage.uploadCategorizedFile.mock.calls[0][0];
    expect(call.storageFilename.startsWith(`${INCIDENT}-`)).toBe(true);
    expect(call.storageFilename).not.toContain('passwd');
    expect(call.storageFilename).not.toContain('etc');
    expect(call.storageFilename).not.toContain('secret');
  });

  it('generates a different random storage key on every call for the same incident', async () => {
    await uploadDriverIncidentEvidence(baseCommand(), STAFF);
    await uploadDriverIncidentEvidence(baseCommand(), STAFF);
    const [first, second] = storage.uploadCategorizedFile.mock.calls;
    expect(first[0].storageFilename).not.toBe(second[0].storageFilename);
  });

  it('sanitizes the display filename independently of the generated storage key', async () => {
    await uploadDriverIncidentEvidence(baseCommand({ filename: '../../evil <script>.jpg' }), STAFF);
    const insertParams = insertTxn.queryOne.mock.calls[0][1] as unknown[];
    const filenameParam = insertParams.find((p) => typeof p === 'string' && p.includes('evil')) as string;
    expect(filenameParam).not.toContain('..');
    expect(filenameParam).not.toContain('<');
    expect(filenameParam).not.toContain('/');
  });

  it('stores a null display filename when none was provided, without inventing one', async () => {
    await uploadDriverIncidentEvidence(baseCommand({ filename: null }), STAFF);
    const insertParams = insertTxn.queryOne.mock.calls[0][1] as unknown[];
    expect(insertParams).toContain(null);
  });
});

describe('driver-scoped evidence + action transaction', () => {
  it('returns the approved same-origin storage URL', async () => {
    const result = await uploadDriverIncidentEvidence(baseCommand(), STAFF);
    expect(result).toEqual({ evidenceId: 'evidence-1', incidentId: INCIDENT, storageUrl: UPLOADED.url });
  });

  it('inserts the evidence row with driver_submitted visibility', async () => {
    await uploadDriverIncidentEvidence(baseCommand(), STAFF);
    const [sql, params] = insertTxn.queryOne.mock.calls[0];
    expect(sql).toContain('fleet_operational_incident_evidence');
    expect(sql).toContain('driver_submitted');
    expect(params).toContain(STAFF);
  });

  it('inserts a driver_submitted evidence_added action attributed to the driver staff id', async () => {
    await uploadDriverIncidentEvidence(baseCommand(), STAFF);
    const [sql, params] = insertTxn.query.mock.calls[0];
    expect(sql).toContain('fleet_operational_incident_actions');
    expect(sql).toContain('evidence_added');
    expect(sql).toContain('driver_submitted');
    expect(params).toContain(STAFF);
  });

  it('writes evidence and action in the same transaction (both calls happen once each)', async () => {
    await uploadDriverIncidentEvidence(baseCommand(), STAFF);
    expect(insertTxn.queryOne).toHaveBeenCalledTimes(1);
    expect(insertTxn.query).toHaveBeenCalledTimes(1);
  });

  it('never mutates incident lifecycle — before/after lifecycle status recorded unchanged', async () => {
    driverInputRepo.lockIncidentForDriver.mockResolvedValue({ ...lockedIncident, lifecycleStatus: 'acknowledged' });
    await uploadDriverIncidentEvidence(baseCommand(), STAFF);
    const [, params] = insertTxn.query.mock.calls[0];
    expect(params).toContain('acknowledged');
  });
});

describe('upload-before-database orphan reference', () => {
  it('records a structured orphan-cleanup reference and throws DriverEvidenceOrphanError when the DB write fails after a successful upload', async () => {
    db.transaction
      .mockImplementationOnce(async (cb: (txn: unknown) => unknown) => cb(insertTxn)) // authorization/eligibility transaction
      .mockRejectedValueOnce(new Error('connection lost')); // insert transaction fails after upload succeeded

    const error = await uploadDriverIncidentEvidence(baseCommand(), STAFF).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DriverEvidenceOrphanError);
    expect((error as DriverEvidenceOrphanError).storageKey).toBe(UPLOADED.key);
    expect((error as DriverEvidenceOrphanError).storageUrl).toBe(UPLOADED.url);
    expect(logger.log.error).toHaveBeenCalledWith(
      expect.stringContaining('orphan'),
      expect.objectContaining({ incidentId: INCIDENT, storageKey: UPLOADED.key, storageUrl: UPLOADED.url }),
      expect.any(String),
    );
  });

  it('never logs base64 file content, including on the orphan path', async () => {
    db.transaction
      .mockImplementationOnce(async (cb: (txn: unknown) => unknown) => cb(insertTxn))
      .mockRejectedValueOnce(new Error('connection lost'));

    await uploadDriverIncidentEvidence(baseCommand(), STAFF).catch(() => undefined);

    for (const call of logger.log.error.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(BASE64);
    }
  });
});
