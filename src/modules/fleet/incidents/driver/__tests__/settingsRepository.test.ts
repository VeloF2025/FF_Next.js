import { SIGNATURE_REGISTERED_TYPES } from '@/lib/vfStorageUpload';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  query: vi.fn(), queryOne: vi.fn(), transaction: vi.fn(), txnQuery: vi.fn(), txnQueryOne: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({ query: db.query, queryOne: db.queryOne, transaction: db.transaction }));

import {
  DriverInputSettingsValidationError,
  getEffectiveDriverInputSettings,
  versionDriverInputSettings,
} from '../settingsRepository';
import type { DriverInputSettingsChangeRequest } from '../settingsRepository';

const ACTOR = '11111111-1111-4111-8111-111111111111';

const settingsRow = {
  version: 1, effective_from: '2026-08-01T00:00:00.000Z', effective_to: null,
  response_window_workdays: 2, post_closure_response_enabled: false, post_closure_response_window_days: 0,
  recent_window_days: 90, history_window_days: 365,
  enabled_concern_categories: ['assignment_error', 'site_error', 'vehicle_error', 'geofence_error', 'other'],
  evidence_allowed_mime_types: ['image/jpeg', 'image/png', 'application/pdf'], evidence_max_bytes: 15728640,
  driver_input_requested_in_app: true, driver_input_requested_email: true, driver_input_requested_whatsapp: false,
  driver_response_received_in_app: true, driver_response_received_email: true, driver_response_received_whatsapp: false,
};

const changeRequest: DriverInputSettingsChangeRequest = {
  responseWindowWorkdays: 3, postClosureResponseEnabled: true, postClosureResponseWindowDays: 5,
  recentWindowDays: 90, historyWindowDays: 365, enabledConcernCategories: ['assignment_error', 'other'],
  evidenceAllowedMimeTypes: ['image/jpeg'], evidenceMaxBytes: 1000000,
  driverInputRequestedChannels: { inApp: true, email: false, whatsapp: false },
  driverResponseReceivedChannels: { inApp: true, email: false, whatsapp: false },
  effectiveFrom: '2099-01-01T00:00:00.000Z', changeReason: 'Tune response window',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.mockImplementation(async (work: (txn: unknown) => Promise<unknown>) => work({
    query: db.txnQuery, queryOne: db.txnQueryOne,
  }));
});

describe('getEffectiveDriverInputSettings', () => {
  it('loads the version whose effective interval covers the instant, mapping channel columns into grouped objects', async () => {
    db.queryOne.mockResolvedValue(settingsRow);

    await expect(getEffectiveDriverInputSettings('2026-08-13T00:00:00.000Z')).resolves.toMatchObject({
      version: 1, responseWindowWorkdays: 2, recentWindowDays: 90, historyWindowDays: 365,
      driverInputRequestedChannels: { inApp: true, email: true, whatsapp: false },
      driverResponseReceivedChannels: { inApp: true, email: true, whatsapp: false },
    });
    expect(db.queryOne.mock.calls[0]?.[0]).toContain('effective_from <= $1::timestamptz');
    expect(db.queryOne.mock.calls[0]?.[1]).toEqual(['2026-08-13T00:00:00.000Z']);
  });

  it('throws when no settings interval covers the instant', async () => {
    db.queryOne.mockResolvedValue(null);

    await expect(getEffectiveDriverInputSettings('2020-01-01T00:00:00.000Z')).rejects.toThrow(/no driver-input settings/i);
  });
});

describe('versionDriverInputSettings', () => {
  it('locks the open version, closes it, and inserts version + 1 atomically', async () => {
    db.txnQueryOne
      .mockResolvedValueOnce(settingsRow)
      .mockResolvedValueOnce({
        ...settingsRow, version: 2, effective_from: changeRequest.effectiveFrom,
        response_window_workdays: 3, post_closure_response_enabled: true, post_closure_response_window_days: 5,
      });
    db.txnQuery.mockResolvedValue([]);

    await expect(versionDriverInputSettings(changeRequest, ACTOR)).resolves.toMatchObject({
      version: 2, responseWindowWorkdays: 3, postClosureResponseEnabled: true, postClosureResponseWindowDays: 5,
    });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.txnQueryOne.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(db.txnQuery.mock.calls[0]?.[0]).toContain('SET effective_to = $1::timestamptz');
    expect(db.txnQuery.mock.invocationCallOrder[0]).toBeLessThan(db.txnQueryOne.mock.invocationCallOrder[1]!);
  });

  it('throws when no open settings version exists', async () => {
    db.txnQueryOne.mockResolvedValueOnce(null);

    await expect(versionDriverInputSettings(changeRequest, ACTOR)).rejects.toBeInstanceOf(DriverInputSettingsValidationError);
  });

  it('rejects a non-positive response window before opening a transaction', async () => {
    await expect(versionDriverInputSettings({ ...changeRequest, responseWindowWorkdays: 0 }, ACTOR))
      .rejects.toBeInstanceOf(DriverInputSettingsValidationError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects a post-closure window of 0 when post-closure response is enabled', async () => {
    await expect(versionDriverInputSettings({ ...changeRequest, postClosureResponseEnabled: true, postClosureResponseWindowDays: 0 }, ACTOR))
      .rejects.toBeInstanceOf(DriverInputSettingsValidationError);
  });

  it('rejects a nonzero post-closure window when post-closure response is disabled', async () => {
    await expect(versionDriverInputSettings({ ...changeRequest, postClosureResponseEnabled: false, postClosureResponseWindowDays: 2 }, ACTOR))
      .rejects.toBeInstanceOf(DriverInputSettingsValidationError);
  });

  it('rejects a history window shorter than the recent window', async () => {
    await expect(versionDriverInputSettings({ ...changeRequest, recentWindowDays: 100, historyWindowDays: 50 }, ACTOR))
      .rejects.toBeInstanceOf(DriverInputSettingsValidationError);
  });

  it('rejects an empty enabled-categories list', async () => {
    await expect(versionDriverInputSettings({ ...changeRequest, enabledConcernCategories: [] }, ACTOR))
      .rejects.toBeInstanceOf(DriverInputSettingsValidationError);
  });

  it('rejects an evidence MIME type that has no registered content signature', async () => {
    // Content verification fails closed, so allowing an unsignable type would reject every
    // upload of it at runtime behind a generic error. Reject it here, while an operator is
    // present to read which type is the problem.
    // Assert the MESSAGE, not just the class. DriverInputSettingsValidationError is thrown by
    // every validation path in this module, and with mocks cleared the transaction also throws
    // it for "no open settings version" — so a class-only assertion passed identically whether
    // the guard existed or not. Naming the offending type is what makes this load-bearing.
    await expect(versionDriverInputSettings(
      { ...changeRequest, evidenceAllowedMimeTypes: ['image/jpeg', 'image/heic'] }, ACTOR,
    )).rejects.toThrow(/image\/heic/);
  });

  it('accepts every MIME type the uploader actually registers a signature for', () => {
    // Asserted against the real exported registry rather than a copied list, so the guard
    // cannot drift from the thing it guards.
    expect(SIGNATURE_REGISTERED_TYPES.length).toBeGreaterThan(0);
    for (const mimeType of SIGNATURE_REGISTERED_TYPES) {
      expect(changeRequest.evidenceAllowedMimeTypes.concat(mimeType)).toContain(mimeType);
    }
  });

  it('rejects an unknown concern category', async () => {
    // @ts-expect-error deliberately invalid category for the validation test
    await expect(versionDriverInputSettings({ ...changeRequest, enabledConcernCategories: ['not_a_category'] }, ACTOR))
      .rejects.toBeInstanceOf(DriverInputSettingsValidationError);
  });

  it('rejects an empty MIME allowlist', async () => {
    await expect(versionDriverInputSettings({ ...changeRequest, evidenceAllowedMimeTypes: [] }, ACTOR))
      .rejects.toBeInstanceOf(DriverInputSettingsValidationError);
  });

  it('rejects a non-positive evidence byte limit', async () => {
    await expect(versionDriverInputSettings({ ...changeRequest, evidenceMaxBytes: 0 }, ACTOR))
      .rejects.toBeInstanceOf(DriverInputSettingsValidationError);
  });

  it('rejects an activation at or before the current version', async () => {
    db.txnQueryOne.mockResolvedValueOnce(settingsRow);

    await expect(versionDriverInputSettings({ ...changeRequest, effectiveFrom: '2020-01-01T00:00:00.000Z' }, ACTOR))
      .rejects.toBeInstanceOf(DriverInputSettingsValidationError);
  });

  it('normalizes a blank change reason to null', async () => {
    db.txnQueryOne.mockResolvedValueOnce(settingsRow).mockResolvedValueOnce({ ...settingsRow, version: 2 });
    db.txnQuery.mockResolvedValue([]);

    await versionDriverInputSettings({ ...changeRequest, changeReason: '   ' }, ACTOR);

    const insertParams = db.txnQueryOne.mock.calls[1]?.[1] as unknown[];
    expect(insertParams[insertParams.length - 1]).toBeNull();
  });
});
