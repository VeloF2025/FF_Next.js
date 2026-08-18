import { describe, expect, it } from 'vitest';
import {
  IncidentValidationError,
  parseOversightAddBody,
  parseOversightEndBody,
  parseRuleChangeBody,
} from '../incidentSettingsValidation';

const validRuleBody = {
  incidentType: 'late', enabled: true, createsIncident: true, severity: 'high',
  immediateNotification: true, channels: { inApp: true, email: true, whatsapp: false },
  includeInMorningSummary: false, acknowledgementTargetMinutes: 15, reminderIntervalMinutes: 10,
  maximumEscalationLevel: 3, evidenceRequiredOutcomes: ['confirmed'],
  effectiveFrom: '2099-01-01T00:00:00.000Z', changeReason: 'Tune targets',
};

describe('parseRuleChangeBody', () => {
  it('accepts a fully valid body', () => {
    const result = parseRuleChangeBody(validRuleBody);
    expect(result).toMatchObject({ incidentType: 'late', severity: 'high', changeReason: 'Tune targets' });
  });

  it('rejects an invalid incidentType', () => {
    expect(() => parseRuleChangeBody({ ...validRuleBody, incidentType: 'bogus' })).toThrow(IncidentValidationError);
  });

  it('rejects an invalid severity', () => {
    expect(() => parseRuleChangeBody({ ...validRuleBody, severity: 'urgent' })).toThrow(IncidentValidationError);
  });

  it('requires the channels object with boolean flags', () => {
    expect(() => parseRuleChangeBody({ ...validRuleBody, channels: undefined })).toThrow(IncidentValidationError);
    expect(() => parseRuleChangeBody({ ...validRuleBody, channels: { inApp: 'yes', email: true, whatsapp: false } })).toThrow(IncidentValidationError);
  });

  it('requires evidenceRequiredOutcomes to be an array of valid outcomes', () => {
    expect(() => parseRuleChangeBody({ ...validRuleBody, evidenceRequiredOutcomes: 'confirmed' })).toThrow(IncidentValidationError);
    expect(() => parseRuleChangeBody({ ...validRuleBody, evidenceRequiredOutcomes: ['not_an_outcome'] })).toThrow(IncidentValidationError);
  });

  it('requires numeric timing fields', () => {
    expect(() => parseRuleChangeBody({ ...validRuleBody, acknowledgementTargetMinutes: '15' })).toThrow(IncidentValidationError);
    expect(() => parseRuleChangeBody({ ...validRuleBody, reminderIntervalMinutes: '10' })).toThrow(IncidentValidationError);
    expect(() => parseRuleChangeBody({ ...validRuleBody, maximumEscalationLevel: '3' })).toThrow(IncidentValidationError);
  });

  it('requires a non-empty changeReason and effectiveFrom string', () => {
    expect(() => parseRuleChangeBody({ ...validRuleBody, changeReason: 42 })).toThrow(IncidentValidationError);
    expect(() => parseRuleChangeBody({ ...validRuleBody, effectiveFrom: 42 })).toThrow(IncidentValidationError);
  });
});

describe('parseOversightAddBody', () => {
  it('requires a valid userId', () => {
    expect(() => parseOversightAddBody({})).toThrow(IncidentValidationError);
    expect(() => parseOversightAddBody({ userId: 'not-a-uuid' })).toThrow(IncidentValidationError);
    const result = parseOversightAddBody({ userId: '11111111-1111-4111-8111-111111111111' });
    expect(result.userId).toBe('11111111-1111-4111-8111-111111111111');
    expect(result.effectiveFrom).toBeUndefined();
    expect(result.reason).toBeNull();
  });

  it('validates an optional effectiveFrom instant', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    expect(() => parseOversightAddBody({ userId, effectiveFrom: 'not-an-instant' })).toThrow(IncidentValidationError);
    const result = parseOversightAddBody({ userId, effectiveFrom: '2099-01-01T00:00:00.000Z', reason: 'New hire' });
    expect(result).toMatchObject({ effectiveFrom: '2099-01-01T00:00:00.000Z', reason: 'New hire' });
  });
});

describe('parseOversightEndBody', () => {
  const membershipId = '22222222-2222-4222-8222-222222222222';

  it('requires a valid membershipId and a non-blank reason', () => {
    expect(() => parseOversightEndBody({})).toThrow(IncidentValidationError);
    expect(() => parseOversightEndBody({ membershipId: 'not-a-uuid', reason: 'left' })).toThrow(IncidentValidationError);
    expect(() => parseOversightEndBody({ membershipId, reason: '   ' })).toThrow(IncidentValidationError);
  });

  it('validates an optional endedAt instant', () => {
    expect(() => parseOversightEndBody({ membershipId, reason: 'left team', endedAt: 'bogus' })).toThrow(IncidentValidationError);
    const result = parseOversightEndBody({ membershipId, reason: 'left team', endedAt: '2099-01-01T00:00:00.000Z' });
    expect(result).toMatchObject({ membershipId, reason: 'left team', endedAt: '2099-01-01T00:00:00.000Z' });
  });
});
