/**
 * GET  /api/tracker/master/[projectId]    — list all master tracker rows for project
 * POST /api/tracker/master/[projectId]    — insert a new master tracker row
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface Params {
  params: Promise<{ projectId: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId } = await params;

    const rows = await sql`
      SELECT * FROM master_tracker
      WHERE project_id = ${projectId}
      ORDER BY zone_no, hld_pon, zone_pon
    `;

    return NextResponse.json({ data: rows });
  } catch (err) {
    log.error('[tracker/master GET]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to fetch master tracker' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId } = await params;
    const body = await req.json() as Record<string, unknown>;

    // All columns in master_tracker (excluding id, created_at, updated_at which are auto-set)
    const columns = [
      'project_id',
      'site',
      'phase',
      'dr',
      'zone_no',
      'hld_pon',
      'zone_pon',
      'pole_label',
      'unique_pole_label',
      'pole_scope',
      'pole_type',
      'pole_route_type',
      'pole_permission_date',
      'pole_install_date',
      'pole_cwc_date',
      'pole_contractor',
      'pole_rate',
      'pole_paid_date',
      'pole_invoice_no',
      'pole_comment',
      'civil_description',
      'civil_rate',
      'civil_qty',
      'civil_total',
      'civil_invoice_no',
      'civil_invoice_date',
      'civil_comment',
      'stringing_description',
      'stringing_rate',
      'stringing_qty',
      'stringing_total',
      'stringing_invoice_no',
      'stringing_date',
      'stringing_comment',
      'signup_date',
      'home_install_date',
      'home_contractor',
      'home_rate',
      'home_paid_date',
      'home_invoice_no',
      'activation_code',
      'activation_date',
      'activation_team',
      'activation_rate',
      'activation_paid_date',
      'activation_invoice_no',
      'remittance',
      'remittance_date',
      'cwc_pole_status',
      'cwc_stringing_status',
      'cwc_qa_submit_date',
      'cwc_qa_approved_date',
      'qa_home_recon_no',
      'exfo_exchange',
      'optical_contractor',
      'optical_type',
      'optical_splitter',
      'optical_prepping',
      'optical_splicing',
      'qa_photos_loaded',
      'atp_qa_submit_date',
      'atp_qa_approved_date',
      'testing_status',
      'test_submitted',
      'olt_port_activation',
      'olt_port_activated',
      'pon_status',
      'optical_rate',
      'optical_invoice_date',
      'optical_invoice_no',
    ];

    // Build dynamic query with all provided columns
    const values = columns.map((col) => body[col] ?? (col === 'project_id' ? projectId : null));
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

    const rows = await sql.query(
      `INSERT INTO master_tracker (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );

    return NextResponse.json({ data: rows[0] }, { status: 201 });
  } catch (err) {
    log.error('[tracker/master POST]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to create master tracker row' }, { status: 500 });
  }
}
