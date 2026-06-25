import { query, queryOne } from '../utils/db';
import { buildInitialChecklists } from '../constants/stages';
import type {
  CreatePlanningItemPayload,
  PlanningFilters,
  PlanningItem,
  PlanningItemWithRelations,
  PlanningListResponse,
  UpdatePlanningItemPayload,
} from '../types/planning';

const SELECT_WITH_RELATIONS = `
  SELECT
    p.*,
    pr.project_name,
    pr.project_code,
    CASE WHEN s.id IS NOT NULL THEN jsonb_build_object(
      'id', s.id,
      'name', COALESCE(s.first_name || ' ' || s.last_name, s.email),
      'email', s.email
    ) ELSE NULL END AS assigned_user
  FROM planning_items p
  LEFT JOIN projects pr ON p.project_id = pr.id
  LEFT JOIN staff s ON p.assigned_to = s.id
`;

export async function generatePlanningUID(forDate?: Date): Promise<string> {
  const target = forDate || new Date();
  const dateStr = target.toISOString().slice(0, 10); // YYYY-MM-DD
  const formatted = dateStr.replace(/-/g, '');        // YYYYMMDD
  const result = await queryOne<{ last_sequence: number }>(
    `INSERT INTO planning_item_sequences (sequence_date, last_sequence)
     VALUES ($1::date, 1)
     ON CONFLICT (sequence_date)
     DO UPDATE SET last_sequence = planning_item_sequences.last_sequence + 1, updated_at = NOW()
     RETURNING last_sequence`,
    [dateStr],
  );
  if (!result) throw new Error('Failed to generate planning UID');
  return `PLN-${formatted}-${String(result.last_sequence).padStart(3, '0')}`;
}

export const PLANNING_FIELD_MAP: Record<string, string> = {
  title: 'title',
  description: 'description',
  scope_area: 'scope_area',
  stage: 'stage',
  assigned_to: 'assigned_to',
  priority: 'priority',
  stage_checklists: 'stage_checklists',
};

export function buildUpdateSql(payload: UpdatePlanningItemPayload): { setSql: string; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(payload)) {
    const col = PLANNING_FIELD_MAP[key];
    if (!col) continue;
    sets.push(`${col} = $${i}`);
    values.push(col === 'stage_checklists' ? JSON.stringify(value) : value);
    i++;
  }
  sets.push('updated_at = NOW()');
  if (payload.stage === 'cancelled' || payload.stage === 'on_hold') {
    if (payload.stage === 'cancelled') sets.push('closed_at = NOW()');
  }
  return { setSql: sets.join(', '), values };
}

export async function listPlanningItems(filters: PlanningFilters = {}): Promise<PlanningListResponse> {
  const where: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (filters.project_id) { where.push(`p.project_id = $${i++}`); values.push(filters.project_id); }
  if (filters.stage) { where.push(`p.stage = $${i++}`); values.push(filters.stage); }
  if (filters.exclude_stage?.length) {
    where.push(`p.stage <> ALL($${i++}::text[])`); values.push(filters.exclude_stage);
  }
  if (filters.assigned_to) { where.push(`p.assigned_to = $${i++}`); values.push(filters.assigned_to); }
  if (filters.search) {
    where.push(`(p.title ILIKE $${i} OR p.item_uid ILIKE $${i} OR p.scope_area ILIKE $${i})`);
    values.push(`%${filters.search}%`); i++;
  }
  if (filters.created_after) { where.push(`p.created_at >= $${i++}`); values.push(filters.created_after); }
  if (filters.created_before) { where.push(`p.created_at <= $${i++}`); values.push(filters.created_before); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 2500;
  const offset = (page - 1) * pageSize;

  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM planning_items p ${whereSql}`, values,
  );
  const total = countRow ? Number(countRow.count) : 0;

  const rows = await query<PlanningItemWithRelations>(
    `${SELECT_WITH_RELATIONS} ${whereSql} ORDER BY p.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...values, pageSize, offset],
  );

  return {
    data: rows,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 0 },
  };
}

export async function getPlanningItemById(id: string): Promise<PlanningItemWithRelations | null> {
  return queryOne<PlanningItemWithRelations>(`${SELECT_WITH_RELATIONS} WHERE p.id = $1`, [id]);
}

export async function createPlanningItem(payload: CreatePlanningItemPayload): Promise<PlanningItem> {
  if (!payload.project_id) throw new Error('project_id is required');
  if (!payload.title || !payload.title.trim()) throw new Error('title is required');

  const uid = await generatePlanningUID();
  const checklists = buildInitialChecklists();

  const row = await queryOne<PlanningItem>(
    `INSERT INTO planning_items
      (item_uid, project_id, title, description, scope_area, stage, assigned_to, priority, source, stage_checklists, pipeline_project_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      uid,
      payload.project_id,
      payload.title.trim(),
      payload.description ?? null,
      payload.scope_area ?? null,
      payload.stage ?? 'intake',
      payload.assigned_to ?? null,
      payload.priority ?? 'normal',
      payload.source ?? 'manual',
      JSON.stringify(checklists),
      null,
      payload.created_by ?? null,
    ],
  );
  if (!row) throw new Error('Failed to create planning item');
  return row;
}

export async function updatePlanningItem(id: string, payload: UpdatePlanningItemPayload): Promise<PlanningItem> {
  if (!payload || Object.keys(payload).length === 0) throw new Error('Update payload cannot be empty');
  const { setSql, values } = buildUpdateSql(payload);
  const row = await queryOne<PlanningItem>(
    `UPDATE planning_items SET ${setSql} WHERE id = $${values.length + 1} RETURNING *`,
    [...values, id],
  );
  if (!row) throw new Error(`Planning item ${id} not found`);
  return row;
}

export async function deletePlanningItem(id: string): Promise<PlanningItem> {
  const row = await queryOne<PlanningItem>(
    `UPDATE planning_items SET stage = 'cancelled', closed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id],
  );
  if (!row) throw new Error(`Planning item ${id} not found`);
  return row;
}

export async function logPlanningActivity(params: {
  planningItemId: string;
  activityType: 'created' | 'stage_change' | 'assignment' | 'checklist' | 'note' | 'cancelled' | 'update';
  fieldChanged?: string;
  oldValue?: string | null;
  newValue?: string | null;
  note?: string | null;
  userId?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO planning_activities
      (planning_item_id, activity_type, field_changed, old_value, new_value, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      params.planningItemId,
      params.activityType,
      params.fieldChanged ?? null,
      params.oldValue ?? null,
      params.newValue ?? null,
      params.note ?? null,
      params.userId ?? null,
    ],
  );
}

export async function listPlanningActivities(planningItemId: string) {
  return query(
    `SELECT * FROM planning_activities WHERE planning_item_id = $1 ORDER BY created_at DESC`,
    [planningItemId],
  );
}
