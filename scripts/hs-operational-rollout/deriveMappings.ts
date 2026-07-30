import type {
  MappingRow,
  RolloutSnapshot,
  TeamMemberRow,
  TeamRow,
} from './types';

function unresolved(
  entity: Pick<MappingRow, 'entityType' | 'entityId' | 'entityName' | 'teamName'>,
  evidenceSource: string
): MappingRow {
  return {
    ...entity,
    proposedContractorId: null,
    evidenceSource,
    confidence: 'NONE',
    approvalStatus: 'pending',
  };
}

function teamMapping(team: TeamRow, members: TeamMemberRow[]): MappingRow {
  const entity = {
    entityType: 'team' as const,
    entityId: team.id,
    entityName: team.name,
    teamName: '',
  };
  const linkedContractors = new Set(
    members
      .filter((member) => member.isActive && member.teamId === team.id && member.contractorId)
      .map((member) => member.contractorId as string)
  );
  if (
    team.contractorId &&
    [...linkedContractors].some((contractorId) => contractorId !== team.contractorId)
  ) {
    return unresolved(
      entity,
      'conflicting teams.contractor_id and team_members.contractor_id'
    );
  }
  if (team.contractorId) {
    return {
      ...entity,
      proposedContractorId: team.contractorId,
      evidenceSource: 'teams.contractor_id',
      confidence: 'HIGH',
      approvalStatus: 'pending',
    };
  }
  if (linkedContractors.size === 1) {
    return {
      ...entity,
      proposedContractorId: [...linkedContractors][0],
      evidenceSource: 'unanimous team_members.contractor_id',
      confidence: 'MEDIUM',
      approvalStatus: 'pending',
    };
  }
  return unresolved(
    entity,
    linkedContractors.size > 1
      ? 'conflicting team_members.contractor_id'
      : 'no explicit contractor evidence'
  );
}

function memberMapping(
  member: TeamMemberRow,
  team: TeamRow | undefined
): MappingRow {
  const entity = {
    entityType: 'team_member' as const,
    entityId: member.id,
    entityName: `${member.firstName} ${member.lastName}`.trim(),
    teamName: team?.name ?? '',
  };
  if (
    member.contractorId &&
    team?.contractorId &&
    member.contractorId !== team.contractorId
  ) {
    return unresolved(
      entity,
      'conflicting team_members.contractor_id and teams.contractor_id'
    );
  }

  const proposedContractorId = member.contractorId ?? team?.contractorId ?? null;
  return proposedContractorId
    ? {
        ...entity,
        proposedContractorId,
        evidenceSource: member.contractorId
          ? 'team_members.contractor_id'
          : 'teams.contractor_id',
        confidence: 'HIGH',
        approvalStatus: 'pending',
      }
    : unresolved(entity, 'no explicit contractor evidence');
}

export function buildMappingRows(snapshot: RolloutSnapshot): MappingRow[] {
  const activeTeams = snapshot.teams.filter((team) => team.isActive);
  const activeMembers = snapshot.members.filter((member) => member.isActive);
  const teamsById = new Map(activeTeams.map((team) => [team.id, team]));
  return [
    ...activeTeams.map((team) => teamMapping(team, activeMembers)),
    ...activeMembers.map((member) =>
      memberMapping(member, teamsById.get(member.teamId ?? ''))
    ),
  ];
}
