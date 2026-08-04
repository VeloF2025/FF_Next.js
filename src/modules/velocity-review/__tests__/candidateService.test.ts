import { describe, expect, it } from 'vitest';
import type { CandidateDbRow } from '../types';
import { prepareCandidate } from '../candidateService';

const SECRET = 'test-only-fingerprint-secret';

function row(overrides: Partial<CandidateDbRow> = {}): CandidateDbRow {
  return {
    dr_number: 'DR-1',
    sources: ['dr_submitted'],
    onemap_phone: null,
    subscriber_phone: null,
    qcontact_phone: null,
    contact_name: 'Ada',
    contact_surname: 'Lovelace',
    subscriber_name: null,
    qcontact_name: null,
    home_signup_date: null,
    signature_present: false,
    signature_evidence_at: null,
    ...overrides,
  };
}

describe('prepareCandidate', () => {
  it('prepares a OneMap phone with home-signup consent', () => {
    expect(prepareCandidate(row({
      onemap_phone: '0821234567',
      home_signup_date: '2026-07-01',
    }), SECRET)).toMatchObject({
      status: 'ready',
      candidate: {
        msisdn: '27821234567',
        phoneE164: '+27821234567',
        phoneSource: 'onemap',
        consentEvidence: {
          source: 'onemap_home_signup',
          grantedAt: new Date('2026-07-01'),
        },
      },
    });
  });

  it('falls back to the subscriber cache phone', () => {
    expect(prepareCandidate(row({
      subscriber_phone: '0831112222',
      home_signup_date: '2026-07-01',
    }), SECRET)).toMatchObject({
      status: 'ready',
      candidate: {
        msisdn: '27831112222',
        phoneSource: 'subscriber_cache',
      },
    });
  });

  it('falls back to the qcontact phone', () => {
    expect(prepareCandidate(row({
      qcontact_phone: '0849998888',
      home_signup_date: '2026-07-01',
    }), SECRET)).toMatchObject({
      status: 'ready',
      candidate: {
        msisdn: '27849998888',
        phoneSource: 'qcontact',
      },
    });
  });

  it('quarantines conflicting normalized phones before source priority', () => {
    expect(prepareCandidate(row({
      onemap_phone: '0821234567',
      qcontact_phone: '0849998888',
      home_signup_date: '2026-07-01',
    }), SECRET)).toEqual({
      status: 'quarantined',
      drNumber: 'DR-1',
      reason: 'phone_conflict',
    });
  });

  it('uses the highest-priority source when normalized phones agree', () => {
    expect(prepareCandidate(row({
      onemap_phone: '082 123 4567',
      subscriber_phone: '+27 82 123 4567',
      qcontact_phone: '27821234567',
      home_signup_date: '2026-07-01',
    }), SECRET)).toMatchObject({
      status: 'ready',
      candidate: { phoneSource: 'onemap' },
    });
  });

  it('uses dated installation-signature consent when signup consent is absent', () => {
    expect(prepareCandidate(row({
      onemap_phone: '0821234567',
      signature_present: true,
      signature_evidence_at: '2026-07-31T08:00:00Z',
    }), SECRET)).toMatchObject({
      status: 'ready',
      candidate: {
        consentEvidence: {
          source: 'onemap_install_signature',
          grantedAt: new Date('2026-07-31T08:00:00Z'),
        },
      },
    });
  });

  it('prefers home-signup consent when both approved evidence classes exist', () => {
    expect(prepareCandidate(row({
      onemap_phone: '0821234567',
      home_signup_date: '2026-07-01',
      signature_present: true,
      signature_evidence_at: '2026-07-31T08:00:00Z',
    }), SECRET)).toMatchObject({
      status: 'ready',
      candidate: { consentEvidence: { source: 'onemap_home_signup' } },
    });
  });

  it('quarantines a candidate without approved consent evidence', () => {
    expect(prepareCandidate(row({
      onemap_phone: '0821234567',
      signature_present: false,
    }), SECRET)).toEqual({
      status: 'quarantined',
      drNumber: 'DR-1',
      reason: 'consent_missing',
    });
  });

  it('requires a timestamp for installation-signature consent', () => {
    expect(prepareCandidate(row({
      onemap_phone: '0821234567',
      signature_present: true,
      signature_evidence_at: null,
    }), SECRET)).toEqual({
      status: 'quarantined',
      drNumber: 'DR-1',
      reason: 'consent_missing',
    });
  });

  it('quarantines a candidate without a valid safe phone', () => {
    expect(prepareCandidate(row({
      onemap_phone: '0111234567',
      home_signup_date: '2026-07-01',
    }), SECRET)).toEqual({
      status: 'quarantined',
      drNumber: 'DR-1',
      reason: 'no_safe_phone',
    });
  });

  it('uses a neutral first-name fallback and preserves distinct source flags', () => {
    expect(prepareCandidate(row({
      sources: ['dr_submitted', 'drops_installed'],
      onemap_phone: '0821234567',
      contact_name: '   ',
      home_signup_date: '2026-07-01',
    }), SECRET)).toMatchObject({
      status: 'ready',
      candidate: {
        firstName: 'there',
        sources: ['dr_submitted', 'drops_installed'],
      },
    });
  });

  it('never includes input phone values in thrown errors', () => {
    const rawPhone = '0821234567';

    expect(() => prepareCandidate(row({
      onemap_phone: rawPhone,
      home_signup_date: '2026-07-01',
    }), '')).toThrowError(expect.not.stringContaining(rawPhone));
  });

  // Regression: the 2026-08-04 run greeted all 262 customers as "Hi There". onemap
  // carried a name for only 27 of them, but dr_photo_unified_reviews.subscriber_name
  // had one for 207 — and nothing read that column.
  const named = { onemap_phone: '0821234567', home_signup_date: '2026-07-01' };

  it('splits a full subscriber name when onemap has none', () => {
    expect(prepareCandidate(row({
      ...named, contact_name: null, contact_surname: null, subscriber_name: 'Thabo Mokoena',
    }), SECRET)).toMatchObject({
      status: 'ready',
      candidate: { firstName: 'Thabo', lastName: 'Mokoena' },
    });
  });

  it('keeps a multi-word family name whole rather than truncating it', () => {
    expect(prepareCandidate(row({
      ...named, contact_name: null, contact_surname: null, subscriber_name: 'Anna van der Merwe',
    }), SECRET)).toMatchObject({
      // Standalone surname field: leading particle is capitalised, inner ones are not.
      candidate: { firstName: 'Anna', lastName: 'Van der Merwe' },
    });
  });

  it('normalises source casing but keeps Afrikaans particles lowercase', () => {
    expect(prepareCandidate(row({
      ...named, contact_name: null, contact_surname: null, subscriber_name: 'betty MOKWENA',
    }), SECRET)).toMatchObject({
      candidate: { firstName: 'Betty', lastName: 'Mokwena' },
    });
    expect(prepareCandidate(row({
      ...named, contact_name: null, contact_surname: null, subscriber_name: 'JOHAN VAN DER MERWE',
    }), SECRET)).toMatchObject({
      candidate: { firstName: 'Johan', lastName: 'Van der Merwe' },
    });
  });

  it('yields no surname for a one-word name instead of duplicating it', () => {
    expect(prepareCandidate(row({
      ...named, contact_name: null, contact_surname: null, subscriber_name: 'Sipho',
    }), SECRET)).toMatchObject({
      candidate: { firstName: 'Sipho', lastName: null },
    });
  });

  it('prefers onemap over the review full name', () => {
    expect(prepareCandidate(row({
      ...named, subscriber_name: 'Wrong Person',
    }), SECRET)).toMatchObject({
      candidate: { firstName: 'Ada', lastName: 'Lovelace' },
    });
  });

  it('falls back to qcontact_name before the placeholder', () => {
    expect(prepareCandidate(row({
      ...named, contact_name: null, contact_surname: null, qcontact_name: 'Lerato Dlamini',
    }), SECRET)).toMatchObject({
      candidate: { firstName: 'Lerato', lastName: 'Dlamini' },
    });
  });

  it('uses the placeholder only when no source carries a name', () => {
    expect(prepareCandidate(row({
      ...named, contact_name: null, contact_surname: null,
    }), SECRET)).toMatchObject({
      candidate: { firstName: 'there', lastName: null },
    });
  });
});
