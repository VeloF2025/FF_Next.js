import { describe, it, expect } from 'vitest';
import { normalizePPTicketBatches, normalizeOltTicketBatches, groupRecordsByProject, resolveTeamForProject, resolvePpTicketGps } from '@/modules/activate/services/ticketBatchService';
import type { ProjectTeamAssignment } from '@/modules/noc/types/team';

describe('normalizePPTicketBatches', () => {
  it('wraps old single-batch body into batches array', () => {
    const body = { pp_data_ids: [1, 2, 3], assigned_team_id: 'team-1' };
    const result = normalizePPTicketBatches(body);
    expect(result).toEqual([{ ids: [1, 2, 3], assigned_team_id: 'team-1' }]);
  });

  it('passes through new batches array', () => {
    const body = {
      batches: [
        { pp_data_ids: [1, 2], assigned_team_id: 'team-a' },
        { pp_data_ids: [3, 4], assigned_team_id: 'team-b' },
      ],
    };
    const result = normalizePPTicketBatches(body);
    expect(result).toEqual([
      { ids: [1, 2], assigned_team_id: 'team-a' },
      { ids: [3, 4], assigned_team_id: 'team-b' },
    ]);
  });
});

describe('groupRecordsByProject', () => {
  it('groups records by their project field', () => {
    const records = [
      { id: 1, project: 'Lawley' },
      { id: 2, project: 'Mohadin' },
      { id: 3, project: 'Lawley' },
    ];
    const groups = groupRecordsByProject(records);
    expect(groups.get('Lawley')).toEqual([1, 3]);
    expect(groups.get('Mohadin')).toEqual([2]);
  });

  it('handles undefined project as Unknown', () => {
    const records = [{ id: 1, project: undefined }, { id: 2, project: null }];
    const groups = groupRecordsByProject(records);
    expect(groups.get('Unknown')).toEqual([1, 2]);
  });

  it('works with string IDs (OLT records)', () => {
    const records = [
      { id: 'abc', project: 'Lawley' },
      { id: 'def', project: 'Lawley' },
    ];
    const groups = groupRecordsByProject(records);
    expect(groups.get('Lawley')).toEqual(['abc', 'def']);
  });
});

describe('resolveTeamForProject', () => {
  it('returns team for matching project with activations role', () => {
    const assignments: ProjectTeamAssignment[] = [
      { id: 'a1', project_id: 'p1', team_id: 't1', role: 'activations', created_at: '', project_name: 'Lawley', team_name: 'Lawley Activations' },
      { id: 'a2', project_id: 'p1', team_id: 't2', role: 'maintenance', created_at: '', project_name: 'Lawley', team_name: 'Lawley Maintenance' },
    ];
    expect(resolveTeamForProject('Lawley', assignments)).toEqual({ team_id: 't1', team_name: 'Lawley Activations' });
  });

  it('returns null when no activations team configured', () => {
    expect(resolveTeamForProject('Tembisa', [])).toBeNull();
  });
});

describe('resolvePpTicketGps', () => {
  it('prefers DR enrichment GPS over the PP row coordinates', () => {
    expect(resolvePpTicketGps('-26.1', '27.9', '-26.7236', '27.0195'))
      .toEqual({ lat: '-26.1', lng: '27.9' });
  });

  it('falls back to PP row GPS when enrichment has none (not_found case)', () => {
    expect(resolvePpTicketGps(undefined, undefined, '-26.7236', '27.0195'))
      .toEqual({ lat: '-26.7236', lng: '27.0195' });
    expect(resolvePpTicketGps(undefined, undefined, -26.7236, 27.0195))
      .toEqual({ lat: '-26.7236', lng: '27.0195' });
  });

  it('returns null when no source has a complete pair', () => {
    expect(resolvePpTicketGps(undefined, undefined, null, null)).toBeNull();
    expect(resolvePpTicketGps('-26.1', undefined, null, null)).toBeNull();
    expect(resolvePpTicketGps(undefined, undefined, '-26.7', null)).toBeNull();
    expect(resolvePpTicketGps(undefined, '27.9', '-26.7', null)).toBeNull();
  });

  it('never mixes axes across sources — falls through to the complete pair', () => {
    expect(resolvePpTicketGps('-26.1', undefined, '-26.7', '27.0'))
      .toEqual({ lat: '-26.7', lng: '27.0' });
    expect(resolvePpTicketGps(undefined, '27.9', '-26.7', '27.0'))
      .toEqual({ lat: '-26.7', lng: '27.0' });
  });

  it('prefers the OES activation coordinate over both design sources', () => {
    expect(
      resolvePpTicketGps('-26.1', '27.9', '-26.7236', '27.0195', -26.5, 27.5)
    ).toEqual({ lat: '-26.5', lng: '27.5' });
  });

  it('accepts an OES pair when neither design source has one', () => {
    expect(resolvePpTicketGps(undefined, undefined, null, null, -26.5, 27.5))
      .toEqual({ lat: '-26.5', lng: '27.5' });
  });

  it('falls through to enrichment when the OES pair is incomplete', () => {
    expect(resolvePpTicketGps('-26.1', '27.9', null, null, -26.5, undefined))
      .toEqual({ lat: '-26.1', lng: '27.9' });
    expect(resolvePpTicketGps('-26.1', '27.9', null, null, undefined, 27.5))
      .toEqual({ lat: '-26.1', lng: '27.9' });
  });

  it('keeps the old ranking when no OES coordinate is supplied', () => {
    expect(resolvePpTicketGps('-26.1', '27.9', '-26.7236', '27.0195'))
      .toEqual({ lat: '-26.1', lng: '27.9' });
  });
});
