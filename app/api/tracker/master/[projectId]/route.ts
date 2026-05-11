/**
 * GET  /api/tracker/master/[projectId]    — list all master tracker rows for project
 * POST /api/tracker/master/[projectId]    — upsert master tracker rows (body: { rows: MasterRow[] })
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { pool } from '@/lib/db-pool';
import { log } from '@/lib/logger';

// All writable columns (excludes id, created_at, updated_at which are auto-set)
const DATA_COLS = [
  'project_id', 'site', 'phase', 'dr', 'zone_no', 'hld_pon', 'zone_pon',
  'pole_label', 'unique_pole_label', 'pole_scope', 'pole_type', 'pole_route_type',
  'pole_permission_date', 'pole_install_date', 'pole_cwc_date', 'pole_contractor',
  'pole_rate', 'pole_paid_date', 'pole_invoice_no', 'pole_comment',
  'civil_description', 'civil_rate', 'civil_qty', 'civil_total',
  'civil_invoice_no', 'civil_invoice_date', 'civil_comment',
  'stringing_description', 'stringing_rate', 'stringing_qty', 'stringing_total',
  'stringing_invoice_no', 'stringing_date', 'stringing_comment',
  'signup_date', 'home_install_date', 'home_contractor', 'home_rate',
  'home_paid_date', 'home_invoice_no', 'activation_code', 'activation_date',
  'activation_team', 'activation_rate', 'activation_paid_date', 'activation_invoice_no',
  'remittance', 'remittance_date', 'cwc_pole_status', 'cwc_stringing_status',
  'cwc_qa_submit_date', 'cwc_qa_approved_date', 'qa_home_recon_no', 'exfo_exchange',
  'optical_contractor', 'optical_type', 'optical_splitter', 'optical_prepping',
  'optical_splicing', 'qa_photos_loaded', 'atp_qa_submit_date', 'atp_qa_approved_date',
  'testing_status', 'test_submitted', 'olt_port_activation', 'olt_port_activated',
  'pon_status', 'optical_rate', 'optical_invoice_date', 'optical_invoice_no',
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Params {
  params: Promise<{ projectId: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId } = await params;
    const { rows } = await pool.query(
      `SELECT * FROM master_tracker WHERE project_id = $1 ORDER BY zone_no, hld_pon, zone_pon`,
      [projectId]
    );
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
    const body = await req.json() as { rows?: Record<string, unknown>[] };
    const rows = body.rows ?? [];

    if (rows.length > 2000) {
      return NextResponse.json({ error: 'Batch too large — max 2000 rows per request' }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ data: [] }, { status: 200 });
    }

    const writeCols = DATA_COLS.filter((c) => c !== 'project_id');
    const client = await pool.connect();
    const results: Record<string, unknown>[] = [];
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        if (row.id) {
          if (typeof row.id !== 'string' || !UUID_RE.test(row.id)) {
            log.warn('[tracker/master POST] skipping row with invalid id', { id: row.id });
            continue;
          }
          const setClauses = writeCols.map((c, i) => `${c} = $${i + 2}`).join(', ');
          const updateVals = [row.id, ...writeCols.map((c) => row[c] ?? null), projectId];
          const projectIdPlaceholder = `$${updateVals.length}`;
          const { rows: updated } = await client.query(
            `UPDATE master_tracker SET ${setClauses}, updated_at = NOW()
             WHERE id = $1 AND project_id = ${projectIdPlaceholder} RETURNING *`,
            updateVals
          );
          if (updated[0]) results.push(updated[0]);
        } else {
          const values = DATA_COLS.map((col) =>
            col === 'project_id' ? projectId : (row[col] ?? null)
          );
          const placeholders = DATA_COLS.map((_, i) => `$${i + 1}`).join(', ');
          const { rows: inserted } = await client.query(
            `INSERT INTO master_tracker (${DATA_COLS.join(', ')}) VALUES (${placeholders}) RETURNING *`,
            values
          );
          if (inserted[0]) results.push(inserted[0]);
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch((rbErr: unknown) => {
        log.error('[tracker/master POST] ROLLBACK failed', { err: String(rbErr) });
      });
      throw err;
    } finally {
      client.release();
    }

    return NextResponse.json({ data: results }, { status: 200 });
  } catch (err) {
    log.error('[tracker/master POST]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to save master tracker' }, { status: 500 });
  }
}
