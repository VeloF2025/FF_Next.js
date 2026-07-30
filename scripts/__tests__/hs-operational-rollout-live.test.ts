import { DataType, newDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import { loadSnapshotFromPool } from '../hs-operational-rollout/loadSnapshot';

function emulateSastNodePgDateParsing<Row>(
  text: string,
  result: { rows: Row[] }
): { rows: Row[] } {
  if (
    !text.includes('FROM hs_daily_checkins c') ||
    text.includes('c.checkin_date::text AS checkin_date')
  ) {
    return result;
  }

  return {
    rows: result.rows.map((row) => {
      const checkinRow = row as Row & { checkin_date?: Date | string };
      if (!checkinRow.checkin_date) return row;
      const storedDate =
        checkinRow.checkin_date instanceof Date
          ? checkinRow.checkin_date.toISOString().slice(0, 10)
          : checkinRow.checkin_date.slice(0, 10);
      return {
        ...checkinRow,
        checkin_date: new Date(`${storedDate}T00:00:00+02:00`),
      };
    }),
  };
}

function enablePgMemDateToTextCast(db: ReturnType<typeof newDb>): void {
  const dateType = db.public.getType(DataType.date) as unknown as {
    doCanCast(to: { primary: string }): boolean | null;
    doCast(
      value: {
        setConversion(
          converter: (raw: Date) => string,
          hashConverter: (text: string) => { text: string }
        ): unknown;
      },
      to: { primary: string }
    ): unknown;
  };
  const canCast = dateType.doCanCast.bind(dateType);
  const cast = dateType.doCast.bind(dateType);
  dateType.doCanCast = (to) => to.primary === DataType.text || canCast(to);
  dateType.doCast = (value, to) =>
    to.primary === DataType.text
      ? value.setConversion(
          (raw) => raw.toISOString().slice(0, 10),
          (text) => ({ text })
        )
      : cast(value, to);
}

describe('H&S operational rollout live loader', () => {
  it('preserves PostgreSQL pure dates when node-postgres runs in SAST', async () => {
    const db = newDb();
    enablePgMemDateToTextCast(db);
    db.public.none(`
      CREATE TABLE contractors (
        id uuid PRIMARY KEY,
        company_name text NOT NULL,
        is_active boolean NOT NULL
      );
      CREATE TABLE teams (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        contractor_id uuid,
        is_active boolean NOT NULL,
        lead_user_id uuid
      );
      CREATE TABLE team_members (
        id uuid PRIMARY KEY,
        team_id uuid,
        contractor_id uuid,
        first_name text,
        last_name text,
        role text,
        is_active boolean NOT NULL,
        is_team_lead boolean NOT NULL,
        user_id uuid
      );
      CREATE TABLE staff (
        id uuid PRIMARY KEY,
        user_id uuid,
        first_name text,
        last_name text,
        name text,
        role text,
        is_active boolean NOT NULL
      );
      CREATE TABLE attendance_entries (
        id uuid PRIMARY KEY,
        staff_id uuid NOT NULL,
        work_date date NOT NULL
      );
      CREATE TABLE hs_daily_checkins (
        id uuid PRIMARY KEY,
        checkin_date date NOT NULL,
        staff_id uuid,
        team_member_id uuid,
        contractor_id uuid,
        worker_name text NOT NULL,
        capture_mode text NOT NULL,
        clearance text NOT NULL,
        declared_activities text[] NOT NULL,
        blocked_reasons text[] NOT NULL
      );

      INSERT INTO contractors VALUES
        ('00000000-0000-4000-8000-000000000001', 'Demo Contractor', true);
      INSERT INTO teams VALUES
        ('10000000-0000-4000-8000-000000000001', 'Demo Team',
         '00000000-0000-4000-8000-000000000001', true, null);
      INSERT INTO team_members VALUES
        ('20000000-0000-4000-8000-000000000001',
         '10000000-0000-4000-8000-000000000001', null,
         'Demo', 'Lead', 'Team Lead', true, true,
         '30000000-0000-4000-8000-000000000001');
      INSERT INTO staff VALUES
        ('50000000-0000-4000-8000-000000000001',
         '30000000-0000-4000-8000-000000000001',
         'Demo', 'Lead', null, 'staff', true),
        ('50000000-0000-4000-8000-000000000002',
         '30000000-0000-4000-8000-000000000002',
         'Other', 'Worker', null, 'supervisor', true);
      INSERT INTO attendance_entries VALUES
        ('60000000-0000-4000-8000-000000000001',
         '50000000-0000-4000-8000-000000000001', '2026-07-30'),
        ('60000000-0000-4000-8000-000000000002',
         '50000000-0000-4000-8000-000000000002', '2026-07-30');
      INSERT INTO hs_daily_checkins VALUES
        ('40000000-0000-4000-8000-000000000001', '2026-07-30',
         '50000000-0000-4000-8000-000000000001', null, null,
         'Demo Lead', 'self', 'blocked',
         ARRAY['working_at_height'], ARRAY['medical_not_current']),
        ('40000000-0000-4000-8000-000000000002', '2026-07-24',
         null, null, null, 'Seven Day Boundary', 'crew_lead', 'blocked',
         ARRAY['plant_operation'], ARRAY['medical_not_current']),
        ('40000000-0000-4000-8000-000000000003', '2026-07-23',
         null, null, null, 'Eight Day Old', 'crew_lead', 'blocked',
         ARRAY['plant_operation'], ARRAY['medical_not_current']);
    `);
    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool();
    const transactionQueries: string[] = [];
    const recordingPool = {
      async connect() {
        const client = await pool.connect();
        return {
          async query<Row>(text: string, values?: unknown[]) {
            transactionQueries.push(text);
            const result = (await client.query(text, values)) as { rows: Row[] };
            return emulateSastNodePgDateParsing(text, result);
          },
          release() {
            client.release();
          },
        };
      },
    };

    try {
      const snapshot = await loadSnapshotFromPool(
        recordingPool,
        new Date('2026-07-30T04:00:00.000Z')
      );

      expect(snapshot.source).toBe('live');
      expect(snapshot.adoption).toEqual({
        snapshotDate: '2026-07-30',
        activeMembers: 1,
        linkedMembers: 0,
        activeTeams: 1,
        linkedTeams: 1,
        activeSupervisors: 1,
        clockedInToday: 2,
        clockedInWithoutCheckin: 1,
        checkinsToday: 1,
        selfCheckinsToday: 1,
        crewCheckinsToday: 0,
        blockedToday: 1,
      });
      expect(snapshot.blockedCheckins).toEqual([
        {
          checkinId: '40000000-0000-4000-8000-000000000001',
          checkinDate: '2026-07-30',
          workerName: 'Demo Lead',
          staffId: '50000000-0000-4000-8000-000000000001',
          teamMemberId: null,
          contractorId: null,
          contractorName: null,
          declaredActivities: ['working_at_height'],
          blockedReasons: ['medical_not_current'],
        },
        {
          checkinId: '40000000-0000-4000-8000-000000000002',
          checkinDate: '2026-07-24',
          workerName: 'Seven Day Boundary',
          staffId: null,
          teamMemberId: null,
          contractorId: null,
          contractorName: null,
          declaredActivities: ['plant_operation'],
          blockedReasons: ['medical_not_current'],
        },
      ]);
      expect(transactionQueries[0]).toBe(
        'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'
      );
      expect(snapshot.leadEvidence).toEqual([
        {
          candidateId: '20000000-0000-4000-8000-000000000001',
          candidateName: 'Demo Lead',
          teamName: 'Demo Team',
          evidenceSource: 'team_members.is_team_lead;team_members.role',
          currentStaffRole: 'staff',
          linkedStaffId: '50000000-0000-4000-8000-000000000001',
        },
      ]);
    } finally {
      await pool.end();
    }
  });
});
