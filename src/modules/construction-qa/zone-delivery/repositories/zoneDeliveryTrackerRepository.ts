import type { PoolClient } from 'pg';

export interface TrackerPonQueryRow {
  project_id: string;
  project_name: string;
  zone_no: number;
  pon_no: number;
  port_submitted_at: Date | null;
  homes_active: number;
}

export interface TrackerHandoverQueryRow {
  project_id: string;
  zone_no: number;
  handed_over_at: Date | null;
}

/**
 * The PON list the operator actually sees, not the one 1Map happens to have
 * synced. `pon_stage_tracking` covers three of eleven projects, so keying the
 * tracker on it would silently omit Etwatwa, Grabouw, Tonga, both Thembisa POPs
 * and half of Mamelodi — 979 of the 1,710 PONs Works QA offers. The delivery
 * tables are therefore joined in as attributes of that list rather than used as
 * its spine, which also means a PON appears here the moment Works QA knows
 * about it, with no lazy row required to read it.
 *
 * Homes active is a fact about the world rather than about FibreFlow's gates:
 * `technically_live` is stamped on zero PONs while 449 PONs have live homes, so
 * a gate-derived "live" count would read zero on a network that is demonstrably
 * carrying traffic.
 */
export async function readTrackerPons(
  client: PoolClient,
  projectId?: string,
): Promise<TrackerPonQueryRow[]> {
  const { rows } = await client.query<TrackerPonQueryRow>(`
    WITH works_qa AS (
      SELECT project_id, zone_no, pon_no
      FROM v_pole_planning
      WHERE pon_no IS NOT NULL AND zone_no IS NOT NULL
        AND ($1::uuid IS NULL OR project_id = $1)
      UNION
      SELECT project_id, zone_no, pon_no
      FROM pole_qa_photos
      WHERE pon_no IS NOT NULL AND zone_no IS NOT NULL
        AND ($1::uuid IS NULL OR project_id = $1)
    ),
    homes AS (
      SELECT d.project_id, d.zone_no, d.pon_no, count(*)::int AS homes_active
      FROM oes_activations oe
      JOIN drops d ON oe.drop_id = d.id
      WHERE oe.status = 'Active'
        AND d.pon_no IS NOT NULL AND d.zone_no IS NOT NULL
        AND ($1::uuid IS NULL OR d.project_id = $1)
      GROUP BY d.project_id, d.zone_no, d.pon_no
    )
    SELECT w.project_id, p.project_name, w.zone_no, w.pon_no,
      s.port_submitted_at,
      COALESCE(h.homes_active, 0)::int AS homes_active
    FROM works_qa w
    JOIN projects p ON p.id = w.project_id
    LEFT JOIN homes h
      ON h.project_id = w.project_id AND h.zone_no = w.zone_no AND h.pon_no = w.pon_no
    LEFT JOIN pon_stage_tracking t
      ON t.project_id = w.project_id AND t.zone_no = w.zone_no AND t.pon_no = w.pon_no
    LEFT JOIN pon_delivery_state s ON s.pon_stage_id = t.id
    ORDER BY p.project_name, w.zone_no, w.pon_no
  `, [projectId ?? null]);
  return rows;
}

export async function readTrackerHandovers(
  client: PoolClient,
  projectId?: string,
): Promise<TrackerHandoverQueryRow[]> {
  const { rows } = await client.query<TrackerHandoverQueryRow>(`
    SELECT project_id, zone_no, handed_over_at
    FROM zone_delivery_state
    WHERE handed_over_at IS NOT NULL
      AND ($1::uuid IS NULL OR project_id = $1)
  `, [projectId ?? null]);
  return rows;
}
