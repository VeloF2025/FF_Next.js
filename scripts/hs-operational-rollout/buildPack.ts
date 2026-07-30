import type {
  MappingRow,
  PackFiles,
  RolloutSnapshot,
  TeamMemberRow,
  TeamRow,
} from './types';

function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function renderCsv(rows: string[][]): string {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function teamMapping(team: TeamRow, members: TeamMemberRow[]): MappingRow {
  if (team.contractorId) {
    return {
      entityType: 'team',
      entityId: team.id,
      entityName: team.name,
      teamName: '',
      proposedContractorId: team.contractorId,
      evidenceSource: 'teams.contractor_id',
      confidence: 'HIGH',
      approvalStatus: 'pending',
    };
  }

  const linkedContractors = new Set(
    members
      .filter((member) => member.isActive && member.teamId === team.id && member.contractorId)
      .map((member) => member.contractorId as string)
  );
  if (linkedContractors.size === 1) {
    return {
      entityType: 'team',
      entityId: team.id,
      entityName: team.name,
      teamName: '',
      proposedContractorId: [...linkedContractors][0],
      evidenceSource: 'unanimous team_members.contractor_id',
      confidence: 'MEDIUM',
      approvalStatus: 'pending',
    };
  }

  return {
    entityType: 'team',
    entityId: team.id,
    entityName: team.name,
    teamName: '',
    proposedContractorId: null,
    evidenceSource:
      linkedContractors.size > 1
        ? 'conflicting team_members.contractor_id'
        : 'no explicit contractor evidence',
    confidence: 'NONE',
    approvalStatus: 'pending',
  };
}

function memberMapping(
  member: TeamMemberRow,
  team: TeamRow | undefined
): MappingRow {
  const inheritedContractorId = team?.contractorId ?? null;
  return {
    entityType: 'team_member',
    entityId: member.id,
    entityName: `${member.firstName} ${member.lastName}`.trim(),
    teamName: team?.name ?? '',
    proposedContractorId: member.contractorId ?? inheritedContractorId,
    evidenceSource: member.contractorId
      ? 'team_members.contractor_id'
      : inheritedContractorId
        ? 'teams.contractor_id'
        : 'no explicit contractor evidence',
    confidence: member.contractorId || inheritedContractorId ? 'HIGH' : 'NONE',
    approvalStatus: 'pending',
  };
}

function buildMappingRows(snapshot: RolloutSnapshot): MappingRow[] {
  const activeTeams = snapshot.teams.filter((team) => team.isActive);
  const activeMembers = snapshot.members.filter((member) => member.isActive);
  const teamsById = new Map(activeTeams.map((team) => [team.id, team]));
  return [
    ...activeTeams.map((team) => teamMapping(team, activeMembers)),
    ...activeMembers.map((member) => memberMapping(member, teamsById.get(member.teamId ?? ''))),
  ];
}

function mappingCsv(snapshot: RolloutSnapshot): string {
  const contractorNames = new Map(
    snapshot.contractors.map((contractor) => [contractor.id, contractor.companyName])
  );
  const rows = buildMappingRows(snapshot).map((row) => [
    row.entityType,
    row.entityId,
    row.entityName,
    row.teamName,
    row.proposedContractorId
      ? contractorNames.get(row.proposedContractorId) ?? row.proposedContractorId
      : '',
    row.evidenceSource,
    row.confidence,
    row.approvalStatus,
  ]);
  return renderCsv([
    [
      'entity_type',
      'entity_id',
      'entity_name',
      'team_name',
      'proposed_contractor',
      'evidence_source',
      'confidence',
      'approval_status',
    ],
    ...rows,
  ]);
}

function medicalCsv(snapshot: RolloutSnapshot): string {
  const rows = snapshot.blockedCheckins.map((row) => [
    row.checkinId,
    row.checkinDate,
    row.workerName,
    row.staffId ? 'staff' : row.teamMemberId ? 'team_member' : 'name_only',
    row.staffId ?? row.teamMemberId ?? '',
    row.contractorName ?? row.contractorId ?? '',
    row.declaredActivities.join(';'),
    row.blockedReasons.join(';'),
  ]);
  return renderCsv([
    [
      'checkin_id',
      'checkin_date',
      'worker_name',
      'worker_type',
      'worker_reference',
      'contractor',
      'declared_activities',
      'blocked_reasons',
    ],
    ...rows,
  ]);
}

function leadCsv(snapshot: RolloutSnapshot): string {
  return renderCsv([
    [
      'candidate_id',
      'candidate_name',
      'team_name',
      'evidence_source',
      'linked_staff_id',
      'current_staff_role',
      'proposed_role',
      'approval_status',
    ],
    ...snapshot.leadEvidence.map((row) => [
      row.candidateId,
      row.candidateName,
      row.teamName ?? '',
      row.evidenceSource,
      row.linkedStaffId ?? '',
      row.currentStaffRole ?? '',
      'supervisor',
      'pending',
    ]),
  ]);
}

function renderAnnouncement(): string {
  return `# DRAFT — DO NOT SEND

Good morning team,

The FibreFlow H&S check-in is required every working day after you clock in and before field work starts. Open **My FibreFlow** and complete **Daily H&S check-in**.

Please answer truthfully. If you are unfit for duty or unsure whether it is safe to continue, declare that honestly and report it to your supervisor or H&S officer. A truthful declaration that you are unfit does not reduce your pay. Never choose an answer merely to obtain clearance.

Crew leads must also submit the subcontractor crew check-in for workers who do not have portal access.

If FibreFlow blocks an activity because evidence such as a current Certificate of Fitness is missing, do not continue with that gated activity. Contact the responsible H&S person so the valid evidence can be captured and reviewed.

Thank you for helping everyone go home safely.
`;
}

function renderReadme(
  snapshot: RolloutSnapshot,
  mappings: MappingRow[]
): string {
  const proposed = mappings.filter((row) => row.proposedContractorId).length;
  const unresolved = mappings.length - proposed;
  return `# H&S Operational Rollout Review Pack

Generated: ${snapshot.generatedAt}
Source: ${snapshot.source}

No production data was changed and no announcement was sent.

## Review summary

- Contractor mappings proposed from explicit evidence: ${proposed}
- Contractor mappings unresolved: ${unresolved}
- Blocked check-ins included for private H&S follow-up: ${snapshot.blockedCheckins.length}
- Crew-lead candidates included for role review: ${snapshot.leadEvidence.length}
- Active team members linked to contractors: ${snapshot.adoption.linkedMembers}/${snapshot.adoption.activeMembers}
- Active teams linked to contractors: ${snapshot.adoption.linkedTeams}/${snapshot.adoption.activeTeams}

## Approval gates

- Hein or the responsible operations owner must approve contractor mappings before any update.
- Hein must approve every staff role change.
- The responsible H&S person must validate medical evidence or authorize a documented override.
- Hein must approve the announcement before it is sent.
`;
}

function renderManifest(
  snapshot: RolloutSnapshot,
  mappings: MappingRow[]
): string {
  const proposed = mappings.filter((row) => row.proposedContractorId).length;
  return `${JSON.stringify(
    {
      source: snapshot.source,
      generatedAt: snapshot.generatedAt,
      snapshotDate: snapshot.adoption.snapshotDate,
      mapping: {
        entities: mappings.length,
        proposed,
        unresolved: mappings.length - proposed,
      },
      medicalBlockers: snapshot.blockedCheckins.length,
      crewLeadCandidates: snapshot.leadEvidence.length,
      adoption: snapshot.adoption,
    },
    null,
    2
  )}\n`;
}

export function buildPack(snapshot: RolloutSnapshot): PackFiles {
  const mappings = buildMappingRows(snapshot);
  return {
    'contractor-mapping.csv': mappingCsv(snapshot),
    'medical-blockers.csv': medicalCsv(snapshot),
    'crew-lead-candidates.csv': leadCsv(snapshot),
    'staff-announcement-DRAFT.md': renderAnnouncement(),
    'manifest.json': renderManifest(snapshot, mappings),
    'README.md': renderReadme(snapshot, mappings),
  };
}
