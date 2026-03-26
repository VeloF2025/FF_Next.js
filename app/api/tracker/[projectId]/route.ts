import { NextResponse } from "next/server";
import { neon } from "@/lib/db-neon";
import { log } from "@/lib/logger";

const sql = neon(process.env.DATABASE_URL ?? "");

interface PonRow {
  id: string;
  zone_no: number | null;
  hld_pon: number | null;
  z_pon: number | null;
  olt_port: string;
  scope_poles: number | null;
  scope_drops: number | null;
  pole_permission: string;
  poles_planted: number | null;
  cwc_poles_date: string;
  cwc_stringing_date: string;
  ready_for_optical: string;
  cwc_qa: boolean;
  optical_splicing_date: string;
  optical_submitted_date: string;
  optical_activated_date: string;
  atp_qa: boolean;
  sign_ups: number | null;
  homes_po: number | null;
  homes_recon: number | null;
  activated: number | null;
  available: number | null;
  blockage: string;
}

interface RouteParams {
  params: { projectId: string };
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { projectId } = params;
  try {
    const rows = await sql\`
      SELECT id, zone_no, hld_pon, z_pon, olt_port,
        scope_poles, scope_drops,
        TO_CHAR(pole_permission, 'YYYY-MM-DD')        AS pole_permission,
        poles_planted,
        TO_CHAR(cwc_poles_date, 'YYYY-MM-DD')         AS cwc_poles_date,
        TO_CHAR(cwc_stringing_date, 'YYYY-MM-DD')     AS cwc_stringing_date,
        TO_CHAR(ready_for_optical, 'YYYY-MM-DD')      AS ready_for_optical,
        cwc_qa,
        TO_CHAR(optical_splicing_date, 'YYYY-MM-DD')  AS optical_splicing_date,
        TO_CHAR(optical_submitted_date, 'YYYY-MM-DD') AS optical_submitted_date,
        TO_CHAR(optical_activated_date, 'YYYY-MM-DD') AS optical_activated_date,
        atp_qa, sign_ups, homes_po, homes_recon,
        activated, available, blockage, updated_at
      FROM pon_tracker_entries
      WHERE project_id = \${projectId}
      ORDER BY zone_no ASC NULLS LAST, hld_pon ASC NULLS LAST
    \`;
    const lastSavedAt = rows.length > 0
      ? (rows[rows.length - 1] as Record<string, unknown>).updated_at as string : null;
    return NextResponse.json({ success: true, data: { pons: rows, lastSavedAt, projectId } });
  } catch (err) {
    log.error("tracker GET failed", { err, projectId }, "api/tracker");
    return NextResponse.json({ success: false, message: "Failed to load" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: RouteParams) {
  const { projectId } = params;
  try {
    const body = (await req.json()) as { pons?: PonRow[] };
    const pons = body.pons ?? [];
    const n = (v: string | null | undefined) => (v === "" || v == null ? null : v);
    for (const p of pons) {
      await sql\`
        INSERT INTO pon_tracker_entries (
          id, project_id, zone_no, hld_pon, z_pon, olt_port,
          scope_poles, scope_drops, pole_permission, poles_planted,
          cwc_poles_date, cwc_stringing_date, ready_for_optical, cwc_qa,
          optical_splicing_date, optical_submitted_date, optical_activated_date, atp_qa,
          sign_ups, homes_po, homes_recon, activated, available, blockage, updated_at
        ) VALUES (
          \${p.id}::uuid, \${projectId}::uuid, \${p.zone_no}, \${p.hld_pon}, \${p.z_pon}, \${p.olt_port || null},
          \${p.scope_poles}, \${p.scope_drops}, \${n(p.pole_permission)}, \${p.poles_planted},
          \${n(p.cwc_poles_date)}, \${n(p.cwc_stringing_date)}, \${n(p.ready_for_optical)}, \${p.cwc_qa},
          \${n(p.optical_splicing_date)}, \${n(p.optical_submitted_date)}, \${n(p.optical_activated_date)}, \${p.atp_qa},
          \${p.sign_ups}, \${p.homes_po}, \${p.homes_recon}, \${p.activated}, \${p.available},
          \${p.blockage || null}, NOW()
        )
        ON CONFLICT (project_id, hld_pon) DO UPDATE SET
          zone_no=EXCLUDED.zone_no, z_pon=EXCLUDED.z_pon, olt_port=EXCLUDED.olt_port,
          scope_poles=EXCLUDED.scope_poles, scope_drops=EXCLUDED.scope_drops,
          pole_permission=EXCLUDED.pole_permission, poles_planted=EXCLUDED.poles_planted,
          cwc_poles_date=EXCLUDED.cwc_poles_date, cwc_stringing_date=EXCLUDED.cwc_stringing_date,
          ready_for_optical=EXCLUDED.ready_for_optical, cwc_qa=EXCLUDED.cwc_qa,
          optical_splicing_date=EXCLUDED.optical_splicing_date,
          optical_submitted_date=EXCLUDED.optical_submitted_date,
          optical_activated_date=EXCLUDED.optical_activated_date,
          atp_qa=EXCLUDED.atp_qa, sign_ups=EXCLUDED.sign_ups, homes_po=EXCLUDED.homes_po,
          homes_recon=EXCLUDED.homes_recon, activated=EXCLUDED.activated,
          available=EXCLUDED.available, blockage=EXCLUDED.blockage, updated_at=NOW()
      \`;
    }
    log.info("tracker saved", { projectId, count: pons.length }, "api/tracker");
    return NextResponse.json({ success: true, data: { saved: pons.length } });
  } catch (err) {
    log.error("tracker POST failed", { err, projectId }, "api/tracker");
    return NextResponse.json({ success: false, message: "Save failed" }, { status: 500 });
  }
}
