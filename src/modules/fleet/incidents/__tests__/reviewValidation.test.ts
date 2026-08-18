import { describe, expect, it } from 'vitest';
import {
  IncidentValidationError,
  parseBulkAcknowledgeBody,
  parseIncidentListQuery,
  parseTransitionBody,
} from '../reviewValidation';

describe('parseIncidentListQuery', () => {
  it('applies defaults when no filters are supplied', () => {
    const result = parseIncidentListQuery({});
    expect(result).toMatchObject({ limit: 25, offset: 0 });
    expect(result.lifecycleStatuses).toBeUndefined();
  });

  it('parses comma-separated enum filters and rejects invalid values', () => {
    const result = parseIncidentListQuery({ lifecycleStatus: 'open,acknowledged', incidentType: 'late,wrong_site', severity: 'high' });
    expect(result.lifecycleStatuses).toEqual(['open', 'acknowledged']);
    expect(result.incidentTypes).toEqual(['late', 'wrong_site']);
    expect(result.severities).toEqual(['high']);
    expect(() => parseIncidentListQuery({ lifecycleStatus: 'bogus' })).toThrow(IncidentValidationError);
    expect(() => parseIncidentListQuery({ incidentType: 'bogus' })).toThrow(IncidentValidationError);
    expect(() => parseIncidentListQuery({ severity: 'bogus' })).toThrow(IncidentValidationError);
  });

  it('validates UUID filters', () => {
    expect(() => parseIncidentListQuery({ projectId: 'not-a-uuid' })).toThrow(IncidentValidationError);
    expect(() => parseIncidentListQuery({ managerUserId: 'not-a-uuid' })).toThrow(IncidentValidationError);
    expect(() => parseIncidentListQuery({ staffId: 'not-a-uuid' })).toThrow(IncidentValidationError);
    const ok = parseIncidentListQuery({ projectId: '11111111-1111-4111-8111-111111111111' });
    expect(ok.projectId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('validates date range filters', () => {
    expect(() => parseIncidentListQuery({ fromDate: '2026-13-40' })).toThrow(IncidentValidationError);
    expect(() => parseIncidentListQuery({ toDate: 'not-a-date' })).toThrow(IncidentValidationError);
    const ok = parseIncidentListQuery({ fromDate: '2026-08-01', toDate: '2026-08-31' });
    expect(ok).toMatchObject({ fromDate: '2026-08-01', toDate: '2026-08-31' });
  });

  it('validates conditionState and evidenceState enums', () => {
    expect(() => parseIncidentListQuery({ conditionState: 'bogus' })).toThrow(IncidentValidationError);
    expect(() => parseIncidentListQuery({ evidenceState: 'bogus' })).toThrow(IncidentValidationError);
    const ok = parseIncidentListQuery({ conditionState: 'active', evidenceState: 'present' });
    expect(ok).toMatchObject({ conditionState: 'active', evidenceState: 'present' });
  });

  it('enforces bounded page/limit values', () => {
    expect(() => parseIncidentListQuery({ limit: '0' })).toThrow(IncidentValidationError);
    expect(() => parseIncidentListQuery({ limit: '101' })).toThrow(IncidentValidationError);
    expect(() => parseIncidentListQuery({ page: 'x' })).toThrow(IncidentValidationError);
    const result = parseIncidentListQuery({ page: '3', limit: '10' });
    expect(result).toMatchObject({ limit: 10, offset: 20 });
  });

  it('parses overdueOnly as a strict boolean flag', () => {
    expect(parseIncidentListQuery({ overdueOnly: 'true' }).overdueOnly).toBe(true);
    expect(parseIncidentListQuery({}).overdueOnly).toBe(false);
  });
});

describe('parseTransitionBody', () => {
  it('accepts a bare acknowledgement with no note', () => {
    const result = parseTransitionBody({ actionType: 'acknowledged' });
    expect(result).toMatchObject({ actionType: 'acknowledged', note: null, outcome: null });
  });

  it('rejects an unknown actionType', () => {
    expect(() => parseTransitionBody({ actionType: 'deleted' })).toThrow(IncidentValidationError);
    expect(() => parseTransitionBody(null)).toThrow(IncidentValidationError);
  });

  it('requires a non-blank note for commented, resolved, and dismissed', () => {
    expect(() => parseTransitionBody({ actionType: 'commented' })).toThrow(IncidentValidationError);
    expect(() => parseTransitionBody({ actionType: 'commented', note: '   ' })).toThrow(IncidentValidationError);
    expect(parseTransitionBody({ actionType: 'commented', note: 'Checked in' }).note).toBe('Checked in');
  });

  it('requires a valid outcome for resolved and dismissed, matching the terminal status', () => {
    expect(() => parseTransitionBody({ actionType: 'resolved', note: 'ok' })).toThrow(IncidentValidationError);
    expect(() => parseTransitionBody({ actionType: 'resolved', note: 'ok', outcome: 'false_positive' })).toThrow(IncidentValidationError);
    expect(() => parseTransitionBody({ actionType: 'dismissed', note: 'ok', outcome: 'confirmed' })).toThrow(IncidentValidationError);
    const resolved = parseTransitionBody({ actionType: 'resolved', note: 'ok', outcome: 'confirmed' });
    expect(resolved.outcome).toBe('confirmed');
    const dismissed = parseTransitionBody({ actionType: 'dismissed', note: 'ok', outcome: 'false_positive' });
    expect(dismissed.outcome).toBe('false_positive');
  });

  it('requires linkedIncidentReference only for a duplicate outcome', () => {
    expect(() => parseTransitionBody({ actionType: 'dismissed', note: 'dup', outcome: 'duplicate' })).toThrow(IncidentValidationError);
    const result = parseTransitionBody({ actionType: 'dismissed', note: 'dup', outcome: 'duplicate', linkedIncidentReference: 'INC-LATE-20260813-ABC123' });
    expect(result.linkedIncidentReference).toBe('INC-LATE-20260813-ABC123');
    expect(parseTransitionBody({ actionType: 'resolved', note: 'ok', outcome: 'confirmed' }).linkedIncidentReference).toBeNull();
  });
});

describe('parseBulkAcknowledgeBody', () => {
  it('requires a non-empty array of UUIDs', () => {
    expect(() => parseBulkAcknowledgeBody({})).toThrow(IncidentValidationError);
    expect(() => parseBulkAcknowledgeBody({ incidentIds: [] })).toThrow(IncidentValidationError);
    expect(() => parseBulkAcknowledgeBody({ incidentIds: ['not-a-uuid'] })).toThrow(IncidentValidationError);
  });

  it('deduplicates repeated ids', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parseBulkAcknowledgeBody({ incidentIds: [id, id] })).toEqual([id]);
  });

  it('rejects more than 50 ids', () => {
    const ids = Array.from({ length: 51 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`);
    expect(() => parseBulkAcknowledgeBody({ incidentIds: ids })).toThrow(IncidentValidationError);
  });
});
