import { describe, expect, it } from 'vitest';

import { buildPack } from '../hs-operational-rollout/buildPack';
import type { RolloutSnapshot } from '../hs-operational-rollout/types';

const snapshot: RolloutSnapshot = {
  source: 'fixture',
  generatedAt: '2026-07-30T04:00:00.000Z',
  adoption: {
    snapshotDate: '2026-07-30',
    activeMembers: 3,
    linkedMembers: 1,
    activeTeams: 2,
    linkedTeams: 1,
    activeSupervisors: 1,
    clockedInToday: 2,
    clockedInWithoutCheckin: 1,
    checkinsToday: 1,
    selfCheckinsToday: 1,
    crewCheckinsToday: 0,
    blockedToday: 1,
  },
  contractors: [
    { id: 'contractor-a', companyName: 'Demo Contractor' },
    { id: 'contractor-b', companyName: 'Other Contractor' },
  ],
  teams: [
    {
      id: 'team-a',
      name: 'Demo Team',
      contractorId: 'contractor-a',
      isActive: true,
    },
    {
      id: 'team-b',
      name: 'Conflict Team',
      contractorId: null,
      isActive: true,
    },
  ],
  members: [
    {
      id: 'member-a',
      teamId: 'team-a',
      contractorId: null,
      firstName: 'Demo',
      lastName: 'Worker',
      role: 'Installer',
      isActive: true,
      isTeamLead: false,
      userId: null,
    },
    {
      id: 'member-b',
      teamId: 'team-b',
      contractorId: 'contractor-a',
      firstName: 'First',
      lastName: 'Lead',
      role: 'Team Lead',
      isActive: true,
      isTeamLead: true,
      userId: 'user-a',
    },
    {
      id: 'member-c',
      teamId: 'team-b',
      contractorId: 'contractor-b',
      firstName: 'Second',
      lastName: 'Lead',
      role: 'Team Lead',
      isActive: true,
      isTeamLead: true,
      userId: 'user-b',
    },
  ],
  blockedCheckins: [
    {
      checkinId: 'checkin-a',
      checkinDate: '2026-07-30',
      workerName: 'Demo, "Worker"',
      staffId: 'staff-a',
      teamMemberId: null,
      contractorId: null,
      contractorName: null,
      declaredActivities: ['working_at_height'],
      blockedReasons: ['medical_not_current'],
    },
  ],
  leadEvidence: [
    {
      candidateId: 'member-b',
      candidateName: 'First, Lead',
      teamName: 'Conflict Team',
      evidenceSource: 'team_members.is_team_lead',
      currentStaffRole: 'staff',
      linkedStaffId: 'staff-b',
    },
    {
      candidateId: 'member-c',
      candidateName: 'Second Lead',
      teamName: 'Conflict Team',
      evidenceSource: 'team_members.is_team_lead',
      currentStaffRole: null,
      linkedStaffId: null,
    },
    {
      candidateId: 'member-d',
      candidateName: 'Admin Lead',
      teamName: 'Demo Team',
      evidenceSource: 'team_members.is_team_lead',
      currentStaffRole: 'admin',
      linkedStaffId: 'staff-d',
    },
  ],
};

describe('H&S operational rollout pack', () => {
  it('proposes mappings only from explicit team or member contractor links', () => {
    const csv = buildPack(snapshot)['contractor-mapping.csv'];

    expect(csv).toContain(
      'team_member,member-a,Demo Worker,Demo Team,Demo Contractor,teams.contractor_id,HIGH,pending'
    );
    expect(csv).toContain(
      'team,team-b,Conflict Team,,,conflicting team_members.contractor_id,NONE,pending'
    );
  });

  it('leaves direct team/member contractor contradictions unresolved', () => {
    const contradictory: RolloutSnapshot = {
      ...snapshot,
      teams: [
        ...snapshot.teams,
        {
          id: 'team-c',
          name: 'Contradiction Team',
          contractorId: 'contractor-a',
          isActive: true,
        },
      ],
      members: [
        ...snapshot.members,
        {
          id: 'member-e',
          teamId: 'team-c',
          contractorId: 'contractor-b',
          firstName: 'Contradictory',
          lastName: 'Worker',
          role: 'Installer',
          isActive: true,
          isTeamLead: false,
          userId: null,
        },
      ],
    };

    const csv = buildPack(contradictory)['contractor-mapping.csv'];

    expect(csv).toContain(
      'team,team-c,Contradiction Team,,,conflicting teams.contractor_id and team_members.contractor_id,NONE,pending'
    );
    expect(csv).toContain(
      'team_member,member-e,Contradictory Worker,Contradiction Team,,conflicting team_members.contractor_id and teams.contractor_id,NONE,pending'
    );
  });

  it('writes the complete private review pack with escaped, minimal blocker data', () => {
    const files = buildPack(snapshot);

    expect(Object.keys(files).sort()).toEqual([
      'README.md',
      'contractor-mapping.csv',
      'crew-lead-candidates.csv',
      'manifest.json',
      'medical-blockers.csv',
      'staff-announcement-DRAFT.md',
    ]);
    expect(files['medical-blockers.csv']).toContain(
      'checkin-a,2026-07-30,"Demo, ""Worker""",staff,staff-a,,working_at_height,medical_not_current'
    );
    expect(files['medical-blockers.csv']).not.toMatch(
      /gps|id_number|clearance_note|medical_note/i
    );
    expect(files['crew-lead-candidates.csv']).toContain(
      'member-b,"First, Lead",Conflict Team,team_members.is_team_lead,staff-b,staff,supervisor,pending'
    );
    expect(files['crew-lead-candidates.csv']).toContain(
      'member-c,Second Lead,Conflict Team,team_members.is_team_lead,,,,identity_link_required'
    );
    expect(files['crew-lead-candidates.csv']).toContain(
      'member-d,Admin Lead,Demo Team,team_members.is_team_lead,staff-d,admin,,access_already_granted'
    );
  });

  it('marks the announcement as unsent and includes the approved safety messages', () => {
    const draft = buildPack(snapshot)['staff-announcement-DRAFT.md'];

    expect(draft).toContain('DRAFT — DO NOT SEND');
    expect(draft).toContain('required every working day after you clock in');
    expect(draft).toContain('does not reduce your pay');
    expect(draft).toContain('answer truthfully');
    expect(draft).toContain('Crew leads');
  });

  it('summarizes source and review counts without worker names', () => {
    const files = buildPack(snapshot);
    const manifest = JSON.parse(files['manifest.json']) as Record<string, unknown>;

    expect(manifest).toMatchObject({
      source: 'fixture',
      generatedAt: '2026-07-30T04:00:00.000Z',
      mapping: {
        entities: 5,
        proposed: 4,
        unresolved: 1,
      },
      medicalBlockers: 1,
      crewLeadCandidates: 3,
      crewLeadRoleChangesReady: 1,
      crewLeadIdentityLinksRequired: 1,
      crewLeadAccessAlreadyGranted: 1,
    });
    expect(files['README.md']).not.toContain('Demo Worker');
    expect(files['README.md']).toContain('No production data was changed');
  });
});
