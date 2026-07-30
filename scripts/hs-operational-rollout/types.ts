export type PackSource = 'fixture' | 'live';
export type MappingConfidence = 'HIGH' | 'MEDIUM' | 'NONE';

export interface AdoptionSummary {
  snapshotDate: string;
  activeMembers: number;
  linkedMembers: number;
  activeTeams: number;
  linkedTeams: number;
  activeSupervisors: number;
  clockedInToday: number;
  clockedInWithoutCheckin: number;
  checkinsToday: number;
  selfCheckinsToday: number;
  crewCheckinsToday: number;
  blockedToday: number;
}

export interface ContractorRow {
  id: string;
  companyName: string;
}

export interface TeamRow {
  id: string;
  name: string;
  contractorId: string | null;
  isActive: boolean;
}

export interface TeamMemberRow {
  id: string;
  teamId: string | null;
  contractorId: string | null;
  firstName: string;
  lastName: string;
  role: string | null;
  isActive: boolean;
  isTeamLead: boolean;
  userId: string | null;
}

export interface BlockedCheckinRow {
  checkinId: string;
  checkinDate: string;
  workerName: string;
  staffId: string | null;
  teamMemberId: string | null;
  contractorId: string | null;
  contractorName: string | null;
  declaredActivities: string[];
  blockedReasons: string[];
}

export interface LeadEvidenceRow {
  candidateId: string;
  candidateName: string;
  teamName: string | null;
  evidenceSource: string;
  currentStaffRole: string | null;
  linkedStaffId: string | null;
}

export interface RolloutSnapshot {
  source: PackSource;
  generatedAt: string;
  adoption: AdoptionSummary;
  contractors: ContractorRow[];
  teams: TeamRow[];
  members: TeamMemberRow[];
  blockedCheckins: BlockedCheckinRow[];
  leadEvidence: LeadEvidenceRow[];
}

export interface MappingRow {
  entityType: 'team' | 'team_member';
  entityId: string;
  entityName: string;
  teamName: string;
  proposedContractorId: string | null;
  evidenceSource: string;
  confidence: MappingConfidence;
  approvalStatus: 'pending';
}

export type PackFiles = Record<string, string>;
