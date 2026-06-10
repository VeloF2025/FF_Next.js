/**
 * Unit tests for classifyDeductionVerdict — pure function judging FT weekly
 * billing deductions against our own evidence. Locks down the verdict rules
 * per note type.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyDeductionVerdict,
  type DeductionEvidence,
} from '../classifyDeductionVerdict';

function evidence(overrides: Partial<DeductionEvidence>): DeductionEvidence {
  return {
    noteCode: 'note1',
    oesStatus: null,
    oesSerial: null,
    oesActivatedAt: null,
    signalDbm: null,
    hasDrRecord: false,
    waReceivedAt: null,
    lastFixSerial: null,
    lastFixAt: null,
    oltFixStatus: null,
    offlineConfirmed: false,
    offlineReason: null,
    offlineRecoveredAt: null,
    ...overrides,
  };
}

describe('note1 — Low Signal', () => {
  it('is disputable when our RX is healthier than -26 dBm', () => {
    const r = classifyDeductionVerdict(evidence({ noteCode: 'note1', signalDbm: -19.4 }));
    expect(r.verdict).toBe('disputable');
  });

  it('is legitimate when our RX is at/below the threshold', () => {
    expect(classifyDeductionVerdict(evidence({ noteCode: 'note1', signalDbm: -26 })).verdict).toBe('legitimate');
    expect(classifyDeductionVerdict(evidence({ noteCode: 'note1', signalDbm: -31.2 })).verdict).toBe('legitimate');
  });

  it('is insufficient_evidence when we hold no RX reading', () => {
    expect(classifyDeductionVerdict(evidence({ noteCode: 'note1', signalDbm: null })).verdict).toBe('insufficient_evidence');
  });
});

describe('note2 — No Field App entry', () => {
  it('is disputable when a DR submission exists in FibreFlow', () => {
    const r = classifyDeductionVerdict(
      evidence({ noteCode: 'note2', hasDrRecord: true, waReceivedAt: '2026-05-12T08:00:00Z' }),
    );
    expect(r.verdict).toBe('disputable');
    expect(r.reasons[0]).toContain('2026-05-12');
  });

  it('is legitimate when no DR record exists on our side', () => {
    expect(classifyDeductionVerdict(evidence({ noteCode: 'note2', hasDrRecord: false })).verdict).toBe('legitimate');
  });
});

describe('note3 — Degraded (monitor only)', () => {
  it('is never judged', () => {
    expect(classifyDeductionVerdict(evidence({ noteCode: 'note3', signalDbm: -10 })).verdict).toBeNull();
  });
});

describe('note4 — Serial mismatch', () => {
  it('is insufficient_evidence without an OES record', () => {
    expect(classifyDeductionVerdict(evidence({ noteCode: 'note4', oesSerial: null })).verdict).toBe('insufficient_evidence');
  });

  it('is disputable when the 1Map fix already matches OES (case-insensitive)', () => {
    const r = classifyDeductionVerdict(
      evidence({
        noteCode: 'note4',
        oesSerial: 'ALCLB48E9A65',
        lastFixSerial: 'alclb48e9a65',
        lastFixAt: '2026-05-20T10:00:00Z',
      }),
    );
    expect(r.verdict).toBe('disputable');
  });

  it('is disputable when our OLT mismatch record is fixed/resolved', () => {
    expect(
      classifyDeductionVerdict(
        evidence({ noteCode: 'note4', oesSerial: 'ALCLB48E9A65', oltFixStatus: 'resolved' }),
      ).verdict,
    ).toBe('disputable');
    expect(
      classifyDeductionVerdict(
        evidence({ noteCode: 'note4', oesSerial: 'ALCLB48E9A65', oltFixStatus: 'fixed' }),
      ).verdict,
    ).toBe('disputable');
  });

  it('is legitimate when the mismatch is unaddressed', () => {
    expect(
      classifyDeductionVerdict(
        evidence({
          noteCode: 'note4',
          oesSerial: 'ALCLB48E9A65',
          lastFixSerial: 'ALCLDIFFERENT',
          oltFixStatus: 'needs_investigation',
        }),
      ).verdict,
    ).toBe('legitimate');
  });
});

describe('note5 — Offline', () => {
  it('is legitimate when our offline sync confirms an unrecovered outage', () => {
    const r = classifyDeductionVerdict(
      evidence({
        noteCode: 'note5',
        oesStatus: 'active',
        offlineConfirmed: true,
        offlineReason: 'Power Outage',
        offlineRecoveredAt: null,
      }),
    );
    expect(r.verdict).toBe('legitimate');
  });

  it('is disputable when the device has since recovered', () => {
    const r = classifyDeductionVerdict(
      evidence({
        noteCode: 'note5',
        offlineConfirmed: true,
        offlineRecoveredAt: '2026-06-01T07:00:00Z',
      }),
    );
    expect(r.verdict).toBe('disputable');
  });

  it('is disputable when the only offline evidence is a Dying Gasp', () => {
    const r = classifyDeductionVerdict(
      evidence({ noteCode: 'note5', offlineConfirmed: true, offlineReason: 'Dying Gasp' }),
    );
    expect(r.verdict).toBe('disputable');
  });

  it('is disputable when OES shows Active and no offline evidence exists', () => {
    const r = classifyDeductionVerdict(evidence({ noteCode: 'note5', oesStatus: 'Active' }));
    expect(r.verdict).toBe('disputable');
  });

  it('is insufficient_evidence with no OES record and no offline evidence', () => {
    expect(classifyDeductionVerdict(evidence({ noteCode: 'note5' })).verdict).toBe('insufficient_evidence');
  });

  it('is legitimate when OES shows a non-active status and nothing else', () => {
    expect(
      classifyDeductionVerdict(evidence({ noteCode: 'note5', oesStatus: 'Inactive' })).verdict,
    ).toBe('legitimate');
  });
});
