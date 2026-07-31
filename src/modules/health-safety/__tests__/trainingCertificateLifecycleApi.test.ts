/**
 * Verification, rejection, revocation and deletion of a certificate submission.
 *
 * One document backs several competencies, so a transition that lands on some
 * rows and not others leaves a worker half-competent in the database. Every case
 * here is about that atomicity, plus the two states that must be immutable:
 * verified and revoked evidence cannot be deleted, only revoked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SqlRow, TxnClient } from '@/lib/db-pool';
import {
  transitionTrainingCertificate,
  deleteTrainingCertificateSubmission,
} from '../services/trainingCertificateLifecycle';
import { TrainingCertificateError } from '../services/trainingCertificateValidation';

const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222';
const STAFF_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR = { userId: 'user-1', staffId: 'staff-verifier' };
const CONTRACTOR = '66666666-6666-6666-6666-666666666666';

interface TxnStub extends TxnClient {
  calls: Array<{ text: string; params: unknown[] }>;
}

interface StubState {
  document?: SqlRow | null;
  linked?: SqlRow[];
}

function createTxn(state: StubState = {}): TxnStub {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const document =
    state.document === undefined
      ? {
          id: DOCUMENT_ID,
          staff_id: STAFF_ID,
          document_type: 'certification',
          verification_status: 'pending',
          file_name: 'cert.pdf',
        }
      : state.document;
  const linked = state.linked ?? [{ id: 'tr-1', contractor_id: null }];

  function route(text: string): SqlRow[] {
    if (text.includes('FROM staff_documents')) return document ? [document] : [];
    if (text.includes('FROM hs_worker_training')) return linked;
    if (text.includes('UPDATE hs_worker_training')) return linked;
    if (text.includes('UPDATE staff_documents')) return document ? [document] : [];
    if (text.includes('DELETE FROM hs_worker_training')) return linked;
    if (text.includes('DELETE FROM staff_documents')) return document ? [document] : [];
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

function updates(txn: TxnStub, table: 'hs_worker_training' | 'staff_documents') {
  return txn.calls.filter((c) => c.text.includes(`UPDATE ${table}`));
}

beforeEach(() => vi.clearAllMocks());

describe('locking', () => {
  it('locks the document and its linked rows before writing', async () => {
    const txn = createTxn();
    await transitionTrainingCertificate(txn, DOCUMENT_ID, ACTOR, { status: 'verified' });

    expect(txn.calls[0].text).toMatch(/FROM staff_documents[\s\S]*FOR UPDATE/);
    const linkedLock = txn.calls.find((c) => c.text.includes('FROM hs_worker_training'));
    expect(linkedLock?.text).toMatch(/FOR UPDATE/);
  });
});

describe('allowed transitions', () => {
  it('verifies a pending submission and stamps the actor on every linked row', async () => {
    const txn = createTxn({ linked: [{ id: 'tr-1', contractor_id: null }, { id: 'tr-2', contractor_id: null }] });
    const result = await transitionTrainingCertificate(txn, DOCUMENT_ID, ACTOR, { status: 'verified' });

    expect(result.status).toBe('verified');
    expect(result.idempotent).toBe(false);

    // One statement covering every linked row, not one per row: a partial
    // update would leave the worker verified for some competencies only.
    const trainingUpdate = updates(txn, 'hs_worker_training');
    expect(trainingUpdate).toHaveLength(1);
    expect(trainingUpdate[0].text).toMatch(/WHERE staff_document_id = \$/);
    expect(trainingUpdate[0].params).toContain(ACTOR.userId);

    const documentUpdate = updates(txn, 'staff_documents');
    expect(documentUpdate).toHaveLength(1);
    // staff_documents.verified_by references staff(id), the training rows
    // reference users(id) — different columns, different actor identifiers.
    expect(documentUpdate[0].params).toContain(ACTOR.staffId);
  });

  it('rejects a pending submission with the reason recorded', async () => {
    const txn = createTxn();
    const result = await transitionTrainingCertificate(txn, DOCUMENT_ID, ACTOR, {
      status: 'rejected',
      reason: 'Certificate is illegible',
    });
    expect(result.status).toBe('rejected');
    expect(updates(txn, 'hs_worker_training')[0].params).toContain('Certificate is illegible');
  });

  it('revokes verified evidence with the reason recorded', async () => {
    const txn = createTxn({
      document: {
        id: DOCUMENT_ID,
        staff_id: STAFF_ID,
        document_type: 'certification',
        verification_status: 'verified',
        file_name: 'cert.pdf',
      },
    });
    const result = await transitionTrainingCertificate(txn, DOCUMENT_ID, ACTOR, {
      status: 'revoked',
      reason: 'Issued in error by the provider',
    });
    expect(result.status).toBe('revoked');
    expect(updates(txn, 'hs_worker_training')[0].params).toContain('Issued in error by the provider');
  });

  it('revoking preserves who verified it and when', async () => {
    // The design requires revocation to keep the document and its audit
    // history. Stamping the revoker over verified_by/verified_at would destroy
    // the record of the original approval on the row a verifier actually reads.
    const txn = createTxn({
      document: {
        id: DOCUMENT_ID,
        staff_id: STAFF_ID,
        document_type: 'certification',
        verification_status: 'verified',
        file_name: 'cert.pdf',
      },
    });
    await transitionTrainingCertificate(txn, DOCUMENT_ID, ACTOR, {
      status: 'revoked',
      reason: 'Issued in error by the provider',
    });

    // Asserted on the conditional's shape, not its exact casts — the casts are
    // required for Postgres type deduction and changed once already, which
    // broke a stricter version of this assertion without any behaviour change.
    const documentUpdate = updates(txn, 'staff_documents')[0];
    expect(documentUpdate.text).toMatch(
      /verified_by = CASE WHEN [^\n]*'verified'[\s\S]*?ELSE verified_by END/
    );
    expect(documentUpdate.text).toMatch(
      /verified_at = CASE WHEN [^\n]*'verified'[\s\S]*?ELSE verified_at END/
    );
  });

  it('leaves the actor nullable on the document when the user has no staff row', async () => {
    const txn = createTxn();
    await transitionTrainingCertificate(
      txn,
      DOCUMENT_ID,
      { userId: 'user-1', staffId: null },
      { status: 'verified' }
    );
    // The training rows still carry the authenticated user id.
    expect(updates(txn, 'hs_worker_training')[0].params).toContain('user-1');
    expect(updates(txn, 'staff_documents')[0].params).toContain(null);
  });

  it('returns the distinct contractors whose score must be recomputed', async () => {
    const txn = createTxn({
      linked: [
        { id: 'tr-1', contractor_id: CONTRACTOR },
        { id: 'tr-2', contractor_id: CONTRACTOR },
        { id: 'tr-3', contractor_id: null },
      ],
    });
    const result = await transitionTrainingCertificate(txn, DOCUMENT_ID, ACTOR, { status: 'verified' });
    expect(result.contractorIds).toEqual([CONTRACTOR]);
  });
});

describe('idempotency and conflicts', () => {
  it('treats a repeat of the same terminal state as a no-op success', async () => {
    const txn = createTxn({
      document: {
        id: DOCUMENT_ID,
        staff_id: STAFF_ID,
        document_type: 'certification',
        verification_status: 'verified',
        file_name: 'cert.pdf',
      },
    });
    const result = await transitionTrainingCertificate(txn, DOCUMENT_ID, ACTOR, { status: 'verified' });
    expect(result.idempotent).toBe(true);
    expect(updates(txn, 'hs_worker_training')).toHaveLength(0);
    expect(updates(txn, 'staff_documents')).toHaveLength(0);
  });

  for (const [from, to] of [
    ['verified', 'rejected'],
    ['rejected', 'verified'],
    ['rejected', 'revoked'],
    ['revoked', 'verified'],
    ['pending', 'revoked'],
  ] as const) {
    it(`refuses ${from} -> ${to}`, async () => {
      const txn = createTxn({
        document: {
          id: DOCUMENT_ID,
          staff_id: STAFF_ID,
          document_type: 'certification',
          verification_status: from,
          file_name: 'cert.pdf',
        },
      });
      const error = await transitionTrainingCertificate(txn, DOCUMENT_ID, ACTOR, {
        status: to,
        reason: 'because',
      } as never).catch((e) => e);
      expect(error).toBeInstanceOf(TrainingCertificateError);
      expect(error.code).toBe('conflict');
      expect(updates(txn, 'hs_worker_training')).toHaveLength(0);
    });
  }

  it('refuses a rejection with no reason', async () => {
    const txn = createTxn();
    const error = await transitionTrainingCertificate(txn, DOCUMENT_ID, ACTOR, {
      status: 'rejected',
      reason: '   ',
    }).catch((e) => e);
    expect(error).toBeInstanceOf(TrainingCertificateError);
    expect(error.code).toBe('invalid_input');
    expect(updates(txn, 'hs_worker_training')).toHaveLength(0);
  });

  it('refuses a revocation with no reason', async () => {
    const txn = createTxn({
      document: {
        id: DOCUMENT_ID,
        staff_id: STAFF_ID,
        document_type: 'certification',
        verification_status: 'verified',
        file_name: 'cert.pdf',
      },
    });
    const error = await transitionTrainingCertificate(txn, DOCUMENT_ID, ACTOR, {
      status: 'revoked',
      reason: '',
    }).catch((e) => e);
    expect(error.code).toBe('invalid_input');
  });

  it('refuses to verify a submission with no linked competency', async () => {
    // Nothing would become effective; silently succeeding would report a
    // verified certificate that satisfies no competency at all.
    const txn = createTxn({ linked: [] });
    const error = await transitionTrainingCertificate(txn, DOCUMENT_ID, ACTOR, {
      status: 'verified',
    }).catch((e) => e);
    expect(error).toBeInstanceOf(TrainingCertificateError);
    expect(updates(txn, 'staff_documents')).toHaveLength(0);
  });

  it('reports an unknown document rather than silently doing nothing', async () => {
    const txn = createTxn({ document: null });
    const error = await transitionTrainingCertificate(txn, DOCUMENT_ID, ACTOR, {
      status: 'verified',
    }).catch((e) => e);
    expect(error.code).toBe('not_found');
  });
});

describe('deletion', () => {
  it('removes the linked rows before the document they reference', async () => {
    const txn = createTxn();
    const result = await deleteTrainingCertificateSubmission(txn, DOCUMENT_ID);

    expect(result).toEqual({ staffId: STAFF_ID, fileName: 'cert.pdf' });
    const trainingDelete = txn.calls.findIndex((c) => c.text.includes('DELETE FROM hs_worker_training'));
    const documentDelete = txn.calls.findIndex((c) => c.text.includes('DELETE FROM staff_documents'));
    expect(trainingDelete).toBeGreaterThan(-1);
    // The foreign key is ON DELETE RESTRICT, so the order is load-bearing.
    expect(trainingDelete).toBeLessThan(documentDelete);
  });

  it('deletes a rejected submission', async () => {
    const txn = createTxn({
      document: {
        id: DOCUMENT_ID,
        staff_id: STAFF_ID,
        document_type: 'certification',
        verification_status: 'rejected',
        file_name: 'cert.pdf',
      },
    });
    await expect(deleteTrainingCertificateSubmission(txn, DOCUMENT_ID)).resolves.toBeTruthy();
  });

  for (const status of ['verified', 'revoked'] as const) {
    it(`refuses to delete a ${status} submission`, async () => {
      const txn = createTxn({
        document: {
          id: DOCUMENT_ID,
          staff_id: STAFF_ID,
          document_type: 'certification',
          verification_status: status,
          file_name: 'cert.pdf',
        },
      });
      const error = await deleteTrainingCertificateSubmission(txn, DOCUMENT_ID).catch((e) => e);
      expect(error).toBeInstanceOf(TrainingCertificateError);
      expect(error.code).toBe('immutable');
      expect(txn.calls.some((c) => c.text.includes('DELETE FROM'))).toBe(false);
    });
  }

  it('reports an unknown document', async () => {
    const txn = createTxn({ document: null });
    const error = await deleteTrainingCertificateSubmission(txn, DOCUMENT_ID).catch((e) => e);
    expect(error.code).toBe('not_found');
  });
});
