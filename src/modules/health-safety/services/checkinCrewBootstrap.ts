/**
 * Bootstrap data for the crew check-in form — everything the page needs in one
 * round-trip. Feature-local (like training/pickers.ts) so the crew form does
 * not depend on the shape of unrelated list endpoints, and so the
 * supervisor/admin gate stays in exactly one file: the route that calls this.
 */

import { sql } from '@/lib/db-pool';

export interface CrewBootstrap {
  projects: { id: string; project_name: string }[];
  contractors: { id: string; company_name: string }[];
  /**
   * contractor_id rides along so the client can filter the roster to the
   * chosen contractor. NULL for every live row today (the known data gap) —
   * the client must treat NULL as "may belong to any contractor", matching
   * classifyTeamMembers' conditional binding, not hide the whole roster.
   */
  team_members: { id: string; name: string; contractor_id: string | null }[];
  /** Crew rows this lead has already recorded today — feeds the hub tile. */
  recorded_today: number;
}

export async function loadCrewBootstrap(
  staffId: string,
  checkinDate: string
): Promise<CrewBootstrap> {
  const [projects, contractors, teamMembers, counted] = await Promise.all([
    sql<{ id: string; project_name: string }>`
      SELECT id, project_name FROM projects
      WHERE status IN ('active', 'in_progress')
      ORDER BY project_name
    `,
    sql<{ id: string; company_name: string }>`
      SELECT id, company_name FROM contractors
      WHERE status IN ('approved', 'pending')
      ORDER BY company_name
    `,
    sql<{ id: string; name: string; contractor_id: string | null }>`
      SELECT id, (first_name || ' ' || last_name) AS name, contractor_id
      FROM team_members WHERE is_active = true
      ORDER BY first_name, last_name
    `,
    sql<{ n: number }>`
      SELECT COUNT(*)::int AS n FROM hs_daily_checkins
      WHERE submitted_by_staff_id = ${staffId}
        AND capture_mode = 'crew_lead'
        AND checkin_date = ${checkinDate}::date
    `,
  ]);
  return {
    projects,
    contractors,
    team_members: teamMembers,
    recorded_today: counted[0]?.n ?? 0,
  };
}
