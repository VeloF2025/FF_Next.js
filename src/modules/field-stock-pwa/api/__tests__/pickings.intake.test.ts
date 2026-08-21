/**
 * submitIssue — the carton payloads the client actually sends.
 *
 * A storeman can scan more than one box of the same item into a single issue
 * (the picker already groups each carton separately). An earlier version sent
 * only the FIRST carton's raw payload, so the second carton's genuinely
 * scanned serials were corroborated against the wrong payload and refused —
 * a narrower version of the exact bug this feature exists to fix.
 *
 * This exercises the REAL submitIssue body builder. An earlier version of this
 * test reimplemented the union in the test file, which meant it could not fail
 * when the production code regressed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const request = vi.fn();
vi.mock('@/modules/field-stock-pwa/api/request', () => ({
  request: (...a: unknown[]) => request(...a),
}));

import { submitIssue } from '../pickings';
import type { PwaScannedSerial } from '../../types';

const CARTON_A = 'ALCLB49486FF;ALCLB4948758;ALCLB4948779';
const CARTON_B = 'ALCLB4949DEF;ALCLB4949F2F;ALCLB4949F3C';

function serial(serialNumber: string, scanPayload?: string): PwaScannedSerial {
  return {
    serialNumber, stockItemId: 'item-ont', stockItemName: 'FT-ONT',
    scannedAt: 1, state: 'valid',
    ...(scanPayload ? { scanPayload, scanSource: 'machine' as const } : {}),
  };
}

function draftWith(serials: PwaScannedSerial[]) {
  return {
    stockItemId: 'item-ont',
    serials,
    sourceLocationId: 'loc-1',
    destinationLocationId: 'loc-2',
    technicianId: 'tech-1',
    signatureDataUrl: null,
    notes: '',
  } as never;
}

/**
 * intakeScanPayloads on the single line of the CREATE call.
 *
 * submitIssue makes several requests (create, then confirm/process/sign), so
 * the last call is not the one carrying the body — reading `.at(-1)` here
 * silently inspected a `{}` body instead.
 */
function sentPayloads(): string[] | undefined {
  const create = request.mock.calls.find(([url]) => url === '/api/my/stores/pickings');
  expect(create, 'the create call should have been made').toBeTruthy();
  const body = JSON.parse((create![1] as { body: string }).body);
  return body.lines[0].intakeScanPayloads;
}

beforeEach(() => {
  request.mockReset();
  // 'processing' makes submitIssue return straight after the create, so the
  // test exercises the body builder without the rest of the chain.
  request.mockResolvedValue({ id: 'pick-1', picking_number: 'PCK-1', status: 'processing' });
});

describe('submitIssue carton payloads', () => {
  it('sends BOTH cartons when two boxes are scanned into one handout', async () => {
    await submitIssue(draftWith([
      serial('ALCLB49486FF', CARTON_A),
      serial('ALCLB4948758', CARTON_A),
      serial('ALCLB4949DEF', CARTON_B),
      serial('ALCLB4949F3C', CARTON_B),
    ]));
    const payloads = sentPayloads();
    // Sending only the first would refuse carton B's genuinely scanned stock.
    expect(payloads).toHaveLength(2);
    expect(payloads).toContain(CARTON_A);
    expect(payloads).toContain(CARTON_B);
  });

  it('deduplicates: one carton scanned once, however many serials it carries', async () => {
    await submitIssue(draftWith([
      serial('ALCLB49486FF', CARTON_A),
      serial('ALCLB4948758', CARTON_A),
      serial('ALCLB4948779', CARTON_A),
    ]));
    expect(sentPayloads()).toEqual([CARTON_A]);
  });

  it('sends nothing for typed serials, so none can be taken into stock', async () => {
    await submitIssue(draftWith([serial('ALCLB49486FF'), serial('ALCLB4948758')]));
    expect(sentPayloads()).toEqual([]);
  });

  it('sends only the scanned carton when a loose serial is typed alongside it', async () => {
    // Hein's actual workflow: 9 in a box plus 1 loose.
    await submitIssue(draftWith([
      serial('ALCLB49486FF', CARTON_A),
      serial('ALCLB4900000'),
    ]));
    expect(sentPayloads()).toEqual([CARTON_A]);
  });
});

describe('label photos for single unlisted units', () => {
  /** intakePhotos on the single line of the CREATE call. */
  function sentPhotos() {
    const create = request.mock.calls.find(([url]) => url === '/api/my/stores/pickings');
    const body = JSON.parse((create![1] as { body: string }).body);
    return body.lines[0].intakePhotos;
  }

  it('sends the photo for a Gizzu the sheet has never listed', async () => {
    // GU18W12V2601016741 was refused outright on 2026-08-21: the 2601 batch is
    // in stock but its range is ...037025-...058200, and a Gizzu has no carton
    // to corroborate it. The photo is what admits it.
    await submitIssue(draftWith([
      { ...serial('GU18W12V2601016741'), intakePhotoKey: 'k1', intakePhotoUrl: 'u1' },
    ]));
    expect(sentPhotos()).toEqual([
      { serialNumber: 'GU18W12V2601016741', photoKey: 'k1', photoUrl: 'u1' },
    ]);
  });

  it('sends nothing for serials with no photo', async () => {
    await submitIssue(draftWith([serial('ALCLB49486FF', CARTON_A)]));
    expect(sentPhotos()).toEqual([]);
  });

  it('keeps each photo tied to ITS OWN serial', async () => {
    // A photo attached to one serial must not admit another — the server
    // matches on the serial, and the body has to carry that pairing.
    await submitIssue(draftWith([
      { ...serial('GU18W12V2601016741'), intakePhotoKey: 'k1' },
      { ...serial('GU18W12V2601016745'), intakePhotoKey: 'k2' },
    ]));
    const photos = sentPhotos() as Array<{ serialNumber: string; photoKey: string }>;
    expect(photos.find((p) => p.serialNumber === 'GU18W12V2601016741')!.photoKey).toBe('k1');
    expect(photos.find((p) => p.serialNumber === 'GU18W12V2601016745')!.photoKey).toBe('k2');
  });
});
