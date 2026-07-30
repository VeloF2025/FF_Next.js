import { Pool } from 'pg';

import type {
  BlockedCheckinRow,
  LeadEvidenceRow,
  RolloutSnapshot,
  TeamMemberRow,
  TeamRow,
} from './types';

interface QueryResult<Row> {
  rows: Row[];
}

interface SnapshotClient {
  query<Row>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
  release(): void;
}

export interface SnapshotPool {
  connect(): Promise<SnapshotClient>;
}

interface ContractorDbRow {
  id: string;
  company_name: string;
}

interface TeamDbRow {
  id: string;
  name: string;
  contractor_id: string | null;
  is_active: boolean;
  lead_user_id: string | null;
}

interface MemberDbRow {
  id: string;
  team_id: string | null;
  contractor_id: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  is_active: boolean;
  is_team_lead: boolean;
  user_id: string | null;
}

interface StaffDbRow {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  role: string | null;
}

interface CheckinDbRow {
  id: string;
  checkin_date: Date | string;
  staff_id: string | null;
  team_member_id: string | null;
  contractor_id: string | null;
  contractor_name: string | null;
  worker_name: string;
  capture_mode: string;
  clearance: string;
  declared_activities: string[];
  blocked_reasons: string[];
}

function sastDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateText(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function memberName(member: TeamMemberRow): string {
  return `${member.firstName} ${member.lastName}`.trim();
}

function buildLeadEvidence(
  teams: Array<TeamRow & { leadUserId: string | null }>,
  members: TeamMemberRow[],
  staff: StaffDbRow[]
): LeadEvidenceRow[] {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const staffByUser = new Map(
    staff.filter((row) => row.user_id).map((row) => [row.user_id as string, row])
  );
  const evidence: LeadEvidenceRow[] = [];

  for (const member of members) {
    const team = member.teamId ? teamsById.get(member.teamId) : undefined;
    const sources: string[] = [];
    if (member.isTeamLead) sources.push('team_members.is_team_lead');
    if (member.role && /(lead|supervisor|foreman)/i.test(member.role)) {
      sources.push('team_members.role');
    }
    if (team?.leadUserId && team.leadUserId === member.userId) {
      sources.push('teams.lead_user_id');
    }
    if (sources.length === 0) continue;

    const linkedStaff = member.userId ? staffByUser.get(member.userId) : undefined;
    evidence.push({
      candidateId: member.id,
      candidateName: memberName(member),
      teamName: team?.name ?? null,
      evidenceSource: sources.join(';'),
      currentStaffRole: linkedStaff?.role ?? null,
      linkedStaffId: linkedStaff?.id ?? null,
    });
  }

  const representedUsers = new Set(members.map((member) => member.userId).filter(Boolean));
  for (const team of teams) {
    if (!team.leadUserId || representedUsers.has(team.leadUserId)) continue;
    const linkedStaff = staffByUser.get(team.leadUserId);
    if (!linkedStaff) continue;
    evidence.push({
      candidateId: linkedStaff.id,
      candidateName:
        linkedStaff.name?.trim() ||
        `${linkedStaff.first_name ?? ''} ${linkedStaff.last_name ?? ''}`.trim(),
      teamName: team.name,
      evidenceSource: 'teams.lead_user_id',
      currentStaffRole: linkedStaff.role,
      linkedStaffId: linkedStaff.id,
    });
  }

  return evidence.sort(
    (left, right) =>
      left.candidateName.localeCompare(right.candidateName) ||
      left.candidateId.localeCompare(right.candidateId)
  );
}

export async function loadSnapshotFromPool(
  pool: SnapshotPool,
  now: Date = new Date()
): Promise<RolloutSnapshot> {
  const snapshotDate = sastDate(now);
  const startDate = shiftDate(snapshotDate, -6);
  const client = await pool.connect();
  try {
    await client.query(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'
    );
    const contractors = await client.query<ContractorDbRow>(
      `SELECT id::text AS id, company_name
       FROM contractors WHERE is_active = true ORDER BY company_name, id`
    );
    const teamsResult = await client.query<TeamDbRow>(
      `SELECT id::text AS id, name, contractor_id::text, is_active,
              lead_user_id::text
       FROM teams WHERE is_active = true ORDER BY name, id`
    );
    const membersResult = await client.query<MemberDbRow>(
      `SELECT id::text AS id, team_id::text, contractor_id::text,
              first_name, last_name, role, is_active, is_team_lead,
              user_id::text
       FROM team_members WHERE is_active = true
       ORDER BY first_name, last_name, id`
    );
    const staffResult = await client.query<StaffDbRow>(
      `SELECT id::text AS id, user_id::text, first_name, last_name, name, role
       FROM staff WHERE is_active = true ORDER BY id`
    );
    const attendance = await client.query<{ staff_id: string }>(
      `SELECT DISTINCT staff_id::text AS staff_id
       FROM attendance_entries WHERE work_date = $1::date`,
      [snapshotDate]
    );
    const checkinsResult = await client.query<CheckinDbRow>(
      `SELECT c.id::text AS id, c.checkin_date,
              c.staff_id::text, c.team_member_id::text, c.contractor_id::text,
              ct.company_name AS contractor_name, c.worker_name,
              c.capture_mode, c.clearance, c.declared_activities,
              c.blocked_reasons
       FROM hs_daily_checkins c
       LEFT JOIN contractors ct ON ct.id = c.contractor_id
       WHERE c.checkin_date BETWEEN $1::date AND $2::date
       ORDER BY c.checkin_date DESC, c.worker_name, c.id`,
      [startDate, snapshotDate]
    );

    const teams = teamsResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      contractorId: row.contractor_id,
      isActive: row.is_active,
      leadUserId: row.lead_user_id,
    }));
    const members: TeamMemberRow[] = membersResult.rows.map((row) => ({
      id: row.id,
      teamId: row.team_id,
      contractorId: row.contractor_id,
      firstName: row.first_name ?? '',
      lastName: row.last_name ?? '',
      role: row.role,
      isActive: row.is_active,
      isTeamLead: row.is_team_lead,
      userId: row.user_id,
    }));
    const checkins = checkinsResult.rows.map((row) => ({
      ...row,
      checkin_date: dateText(row.checkin_date),
    }));
    const todayCheckins = checkins.filter(
      (row) => row.checkin_date === snapshotDate
    );
    const selfCheckins = new Set(
      todayCheckins
        .filter((row) => row.capture_mode === 'self' && row.staff_id)
        .map((row) => row.staff_id as string)
    );
    const clockedIn = new Set(attendance.rows.map((row) => row.staff_id));
    const blockedCheckins: BlockedCheckinRow[] = checkins
      .filter((row) => row.clearance === 'blocked')
      .map((row) => ({
        checkinId: row.id,
        checkinDate: row.checkin_date,
        workerName: row.worker_name,
        staffId: row.staff_id,
        teamMemberId: row.team_member_id,
        contractorId: row.contractor_id,
        contractorName: row.contractor_name,
        declaredActivities: row.declared_activities ?? [],
        blockedReasons: row.blocked_reasons ?? [],
      }));

    await client.query('COMMIT');
    return {
      source: 'live',
      generatedAt: now.toISOString(),
      adoption: {
        snapshotDate,
        activeMembers: members.length,
        linkedMembers: members.filter((row) => row.contractorId).length,
        activeTeams: teams.length,
        linkedTeams: teams.filter((row) => row.contractorId).length,
        activeSupervisors: staffResult.rows.filter((row) => row.role === 'supervisor')
          .length,
        clockedInToday: clockedIn.size,
        clockedInWithoutCheckin: [...clockedIn].filter((id) => !selfCheckins.has(id))
          .length,
        checkinsToday: todayCheckins.length,
        selfCheckinsToday: todayCheckins.filter((row) => row.capture_mode === 'self')
          .length,
        crewCheckinsToday: todayCheckins.filter(
          (row) => row.capture_mode === 'crew_lead'
        ).length,
        blockedToday: todayCheckins.filter((row) => row.clearance === 'blocked')
          .length,
      },
      contractors: contractors.rows.map((row) => ({
        id: row.id,
        companyName: row.company_name,
      })),
      teams,
      members,
      blockedCheckins,
      leadEvidence: buildLeadEvidence(teams, members, staffResult.rows),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function loadLiveSnapshot(databaseUrl: string): Promise<RolloutSnapshot> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    return await loadSnapshotFromPool(pool);
  } finally {
    await pool.end();
  }
}
