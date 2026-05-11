/**
 * PATCH /api/tracker/build/[projectId]/overrides
 * Body: { pon_stage_id: string, field: string, value: unknown }
 * Upserts pon_manual_overrides for the given pon_stage_id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { pool } from '@/lib/db-pool';
import { log } from '@/lib/logger';

const ALLOWED_FIELDS = new Set([
  'blockage', 'civil_contractor', 'stringing_contractor',
  'optical_contractor', 'optical_splitter', 'optical_type',
  'atp_submitter_notes', 'override_notes',
]);

interface Params { params: Promise<{ projectId: string }> }
interface OverrideBody { pon_stage_id: string; field: string; value: unknown }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await params;
    const body = await req.json() as OverrideBody;

    if (!body.pon_stage_id || !body.field) {
      return NextResponse.json({ error: 'pon_stage_id and field required' }, { status: 400 });
    }
    if (!ALLOWED_FIELDS.has(body.field)) {
      return NextResponse.json({ error: `Field '${body.field}' is not PM-editable` }, { status: 400 });
    }

    const { rows } = await pool.query(
      `INSERT INTO pon_manual_overrides (pon_stage_id, ${body.field}, updated_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (pon_stage_id) DO UPDATE
         SET ${body.field} = EXCLUDED.${body.field},
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
       RETURNING *`,
      [body.pon_stage_id, body.value ?? null, auth.userId]
    );

    return NextResponse.json({ data: rows[0] });
  } catch (err) {
    log.error('[tracker/build/overrides PATCH]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to save override' }, { status: 500 });
  }
}
