/**
 * Training-certificate domain service: mapping, expiry, duplicates, transaction.
 *
 * The service never touches storage and never opens its own transaction — it
 * receives a TxnClient so the upload route can compensate a storage write when
 * the database half fails. These tests drive it through a stub TxnClient and
 * assert on the SQL it issues, because the invariants that matter here are
 * "one document, N linked rows, all pending, all pointing at the same id".
 */

import { describe, it, expect } from 'vitest';
import type { SqlRow, TxnClient } from '@/lib/db-pool';
import {
  createTrainingCertificateSubmission,
  resolveTrainingExpiry,
  TrainingCertificateError,
  type CreateTrainingCertificateInput,
} from '../services/trainingCertificateService';

const STAFF_ID = '11111111-1111-1111-1111-111111111111';
const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222';
const ACTOR_ID = '33333333-3333-3333-3333-333333333333';
const HEIGHTS = '44444444-4444-4444-4444-444444444444';
const SPLICING = '55555555-5555-5555-5555-555555555555';

interface TxnStubOptions {
  staff?: SqlRow[];
  types?: SqlRow[];
  duplicates?: SqlRow[];
}

interface TxnStub extends TxnClient {
  calls: Array<{ text: string; params: unknown[] }>;
}

function createTxn(options: TxnStubOptions = {}): TxnStub {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  let trainingSeq = 0;

  function route(text: string): SqlRow[] {
    if (text.includes('INSERT INTO staff_documents')) return [{ id: DOCUMENT_ID }];
    if (text.includes('INSERT INTO hs_worker_training')) {
      trainingSeq += 1;
      return [{ id: `training-${trainingSeq}` }];
    }
    if (text.includes('FROM staff_documents')) return options.duplicates ?? [];
    if (text.includes('FROM hs_training_types')) {
      return options.types ?? [{ id: HEIGHTS, code: 'working_at_heights', validity_months: 24 }];
    }
    if (text.includes('FROM staff')) {
      return options.staff ?? [{ id: STAFF_ID, name: 'Test Worker' }];
    }
    throw new Error(`Unexpected query: ${text}`);
  }

  const txn: TxnStub = {
    calls,
    client: {} as TxnClient['client'],
    async query<T extends SqlRow = SqlRow>(text: string, params: unknown[] = []): Promise<T[]> {
      calls.push({ text, params });
      return route(text) as T[];
    },
    async queryOne<T extends SqlRow = SqlRow>(text: string, params: unknown[] = []): Promise<T | null> {
      const rows = await txn.query<T>(text, params);
      return rows[0] ?? null;
    },
  };
  return txn;
}

function input(overrides: Partial<CreateTrainingCertificateInput> = {}): CreateTrainingCertificateInput {
  return {
    staffId: STAFF_ID,
    trainingTypeIds: [HEIGHTS],
    certificateNumber: 'CERT-001',
    provider: 'Acme Training',
    completedDate: '2026-01-15',
    explicitExpiryDate: null,
    fileName: 'cert.pdf',
    filePath: 'staff/documents/cert.pdf',
    fileUrl: 'https://storage.example/staff/documents/cert.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    actorUserId: ACTOR_ID,
    ...overrides,
  };
}

function insertedTraining(txn: TxnStub) {
  return txn.calls.filter((c) => c.text.includes('INSERT INTO hs_worker_training'));
}

describe('resolveTrainingExpiry', () => {
  it('prefers the expiry printed on the certificate over the catalogue cadence', () => {
    expect(resolveTrainingExpiry('2026-01-15', '2027-06-30', 24)).toBe('2027-06-30');
  });

  it('derives the expiry from the catalogue validity when none is printed', () => {
    expect(resolveTrainingExpiry('2026-01-15', null, 24)).toBe('2028-01-15');
  });

  it('does not invent an expiry when the competency has no cadence', () => {
    expect(resolveTrainingExpiry('2026-01-15', null, null)).toBeNull();
  });

  it('clamps to the last valid day of the target month', () => {
    // 31 Aug + 6 months is 31 Feb, which does not exist.
    expect(resolveTrainingExpiry('2025-08-31', null, 6)).toBe('2026-02-28');
    expect(resolveTrainingExpiry('2023-08-31', null, 6)).toBe('2024-02-29');
  });

  it('uses UTC calendar arithmetic, not the host timezone', () => {
    // A local-time Date would shift this by a day in SAST (UTC+2).
    expect(resolveTrainingExpiry('2026-01-01', null, 12)).toBe('2027-01-01');
    expect(resolveTrainingExpiry('2026-12-31', null, 1)).toBe('2027-01-31');
  });

  it('rejects a malformed date rather than producing Invalid Date', () => {
    expect(() => resolveTrainingExpiry('15/01/2026', null, 24)).toThrow(TrainingCertificateError);
    expect(() => resolveTrainingExpiry('2026-02-30', null, 24)).toThrow(TrainingCertificateError);
  });
});

describe('createTrainingCertificateSubmission', () => {
  it('creates one document and one pending linked row for a single competency', async () => {
    const txn = createTxn();
    const result = await createTrainingCertificateSubmission(txn, input());

    expect(result.documentId).toBe(DOCUMENT_ID);
    expect(result.trainingRecordIds).toEqual(['training-1']);
    expect(result.verificationStatus).toBe('pending');

    const documentInserts = txn.calls.filter((c) => c.text.includes('INSERT INTO staff_documents'));
    expect(documentInserts).toHaveLength(1);
    // The document type is fixed by this route, not chosen by the caller.
    expect(documentInserts[0].text).toContain("'certification'");
    // Provider is the issuing authority; the certificate number is the document number.
    expect(documentInserts[0].params).toContain('Acme Training');
    expect(documentInserts[0].params).toContain('CERT-001');
    // 'pending' is a constant, so it belongs inline in the SQL rather than as a
    // parameter — a submission must not be able to arrive pre-verified.
    expect(documentInserts[0].text).toMatch(/verification_status[\s\S]*?'pending'/);
  });

  it('links every selected competency to the one stored binary', async () => {
    const txn = createTxn({
      types: [
        { id: HEIGHTS, code: 'working_at_heights', validity_months: 24 },
        { id: SPLICING, code: 'fibre_splicing', validity_months: null },
      ],
    });
    const result = await createTrainingCertificateSubmission(
      txn,
      input({ trainingTypeIds: [HEIGHTS, SPLICING] })
    );

    expect(txn.calls.filter((c) => c.text.includes('INSERT INTO staff_documents'))).toHaveLength(1);
    expect(result.trainingRecordIds).toEqual(['training-1', 'training-2']);

    const rows = insertedTraining(txn);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.params).toContain(DOCUMENT_ID);
      expect(row.text).toMatch(/'pending'/);
    }
  });

  it('derives each linked row its own expiry from its own catalogue entry', async () => {
    const txn = createTxn({
      types: [
        { id: HEIGHTS, code: 'working_at_heights', validity_months: 24 },
        { id: SPLICING, code: 'fibre_splicing', validity_months: null },
      ],
    });
    await createTrainingCertificateSubmission(txn, input({ trainingTypeIds: [HEIGHTS, SPLICING] }));

    const rows = insertedTraining(txn);
    expect(rows[0].params).toContain('2028-01-15');
    expect(rows[1].params).toContain(null);
  });

  it('applies one printed expiry to every selected competency', async () => {
    const txn = createTxn({
      types: [
        { id: HEIGHTS, code: 'working_at_heights', validity_months: 24 },
        { id: SPLICING, code: 'fibre_splicing', validity_months: null },
      ],
    });
    await createTrainingCertificateSubmission(
      txn,
      input({ trainingTypeIds: [HEIGHTS, SPLICING], explicitExpiryDate: '2027-03-01' })
    );

    for (const row of insertedTraining(txn)) {
      expect(row.params).toContain('2027-03-01');
    }
  });

  it('locks the employee row before writing anything', async () => {
    const txn = createTxn();
    await createTrainingCertificateSubmission(txn, input());

    expect(txn.calls[0].text).toMatch(/FROM staff\b/);
    expect(txn.calls[0].text).toMatch(/FOR UPDATE/);
  });

  it('rejects an unknown employee', async () => {
    const txn = createTxn({ staff: [] });
    await expect(createTrainingCertificateSubmission(txn, input())).rejects.toThrow(
      TrainingCertificateError
    );
    expect(insertedTraining(txn)).toHaveLength(0);
  });

  it('rejects a repeated training type rather than silently de-duplicating it', async () => {
    const txn = createTxn();
    await expect(
      createTrainingCertificateSubmission(txn, input({ trainingTypeIds: [HEIGHTS, HEIGHTS] }))
    ).rejects.toThrow(/more than once/i);
    expect(insertedTraining(txn)).toHaveLength(0);
  });

  it('rejects an empty competency selection', async () => {
    const txn = createTxn();
    await expect(
      createTrainingCertificateSubmission(txn, input({ trainingTypeIds: [] }))
    ).rejects.toThrow(TrainingCertificateError);
  });

  it('rejects an unknown or inactive competency by count mismatch', async () => {
    // The lookup filters on is_active, so an inactive type simply does not come
    // back — asserting on the returned count is what catches both cases.
    const txn = createTxn({ types: [{ id: HEIGHTS, code: 'working_at_heights', validity_months: 24 }] });
    await expect(
      createTrainingCertificateSubmission(txn, input({ trainingTypeIds: [HEIGHTS, SPLICING] }))
    ).rejects.toThrow(TrainingCertificateError);
    expect(insertedTraining(txn)).toHaveLength(0);
  });

  it('only considers active types', async () => {
    const txn = createTxn();
    await createTrainingCertificateSubmission(txn, input());
    const lookup = txn.calls.find((c) => c.text.includes('FROM hs_training_types'));
    expect(lookup?.text).toMatch(/is_active/);
  });

  it('rejects a duplicate live certificate for the same employee and provider', async () => {
    const txn = createTxn({ duplicates: [{ id: 'existing-doc' }] });
    const error = await createTrainingCertificateSubmission(txn, input()).catch((e) => e);
    expect(error).toBeInstanceOf(TrainingCertificateError);
    expect(error.code).toBe('duplicate_certificate');
    expect(insertedTraining(txn)).toHaveLength(0);
  });

  it('compares certificate numbers ignoring case and surrounding whitespace', async () => {
    const txn = createTxn();
    await createTrainingCertificateSubmission(txn, input());
    const check = txn.calls.find((c) => c.text.includes('FROM staff_documents'));
    expect(check?.text).toMatch(/LOWER\(BTRIM\(/);
    expect(check?.text).toMatch(/verification_status IN \('pending', 'verified'\)/);
  });

  it('rejects an expiry that precedes completion', async () => {
    const txn = createTxn();
    await expect(
      createTrainingCertificateSubmission(txn, input({ explicitExpiryDate: '2025-12-31' }))
    ).rejects.toThrow(TrainingCertificateError);
    expect(insertedTraining(txn)).toHaveLength(0);
  });

  it('rejects a blank certificate number or provider', async () => {
    const txn = createTxn();
    await expect(
      createTrainingCertificateSubmission(txn, input({ certificateNumber: '   ' }))
    ).rejects.toThrow(TrainingCertificateError);
    await expect(
      createTrainingCertificateSubmission(txn, input({ provider: '' }))
    ).rejects.toThrow(TrainingCertificateError);
  });

  it('stores the worker name snapshot from the locked staff row', async () => {
    const txn = createTxn({ staff: [{ id: STAFF_ID, name: 'Thandi Nkosi' }] });
    await createTrainingCertificateSubmission(txn, input());
    expect(insertedTraining(txn)[0].params).toContain('Thandi Nkosi');
  });

  it('parameterises every value it writes', async () => {
    const txn = createTxn();
    await createTrainingCertificateSubmission(txn, input());
    for (const call of txn.calls) {
      expect(call.text).not.toContain(STAFF_ID);
      expect(call.text).not.toContain('CERT-001');
    }
  });

  it('translates a unique-violation race into the duplicate error', async () => {
    const txn = createTxn();
    const original = txn.query.bind(txn);
    txn.query = async (text: string, params: unknown[] = []) => {
      if (text.includes('INSERT INTO staff_documents')) {
        const err = new Error('duplicate key value violates unique constraint') as Error & {
          code?: string;
        };
        err.code = '23505';
        throw err;
      }
      return original(text, params);
    };

    const error = await createTrainingCertificateSubmission(txn, input()).catch((e) => e);
    expect(error).toBeInstanceOf(TrainingCertificateError);
    expect(error.code).toBe('duplicate_certificate');
  });
});
