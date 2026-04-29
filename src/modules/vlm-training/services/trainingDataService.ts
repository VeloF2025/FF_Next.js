import { query, queryOne } from '@/lib/db-pool';

export interface TrainingDrop extends Record<string, unknown> {
  id: string;
  drop_number: string;
  project_name: string | null;
  region: string;
  installer_name: string | null;
  installation_date: string | null;
  latitude: number | null;
  longitude: number | null;
  location_address: string | null;
  core_steps_present: number;
  dome_steps_present: number;
  steps_present: Record<string, boolean>;
  photos_metadata: PhotoMeta[];
  source: string;
  snapshot_at: string;
  excluded_from_training: boolean;
  excluded_reason: string | null;
  created_at: string;
}

export interface PhotoMeta {
  step: string | null;
  field: string;
  filename: string;
  url: string;
  attachmentId: number;
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  region?: string;
  minSteps?: number;
  excludedOnly?: boolean;
  activeOnly?: boolean;
}

export interface ListResult {
  rows: TrainingDrop[];
  total: number;
  regions: string[];
}

export async function listTrainingDrops(params: ListParams): Promise<ListResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (params.region && params.region !== 'all') {
    conditions.push(`region = $${idx++}`);
    values.push(params.region);
  }

  if (params.minSteps) {
    conditions.push(`core_steps_present >= $${idx++}`);
    values.push(params.minSteps);
  }

  if (params.activeOnly) {
    conditions.push('excluded_from_training = false');
  } else if (params.excludedOnly) {
    conditions.push('excluded_from_training = true');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await queryOne<{ total: string }>(
    `SELECT COUNT(*) as total FROM vlm_training_dataset ${where}`,
    values
  );

  const rows = await query<TrainingDrop>(
    `SELECT * FROM vlm_training_dataset ${where}
     ORDER BY region, core_steps_present DESC, created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...values, pageSize, offset]
  );

  const regionRows = await query<{ region: string }>(
    'SELECT DISTINCT region FROM vlm_training_dataset ORDER BY region'
  );

  return {
    rows,
    total: parseInt(countResult?.total ?? '0', 10),
    regions: regionRows.map((r) => r.region),
  };
}

export async function getTrainingDrop(dropNumber: string): Promise<TrainingDrop | null> {
  return queryOne<TrainingDrop>(
    'SELECT * FROM vlm_training_dataset WHERE drop_number = $1',
    [dropNumber]
  );
}

export async function getRegionSummary(): Promise<
  { region: string; total: number; active: number; avg_steps: number }[]
> {
  return query(
    `SELECT
       region,
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE excluded_from_training = false) as active,
       ROUND(AVG(core_steps_present), 1) as avg_steps
     FROM vlm_training_dataset
     GROUP BY region
     ORDER BY total DESC`
  );
}

export async function excludeTrainingDrop(
  dropNumber: string,
  reason: string,
  excludedBy: string
): Promise<boolean> {
  const rows = await query<{ drop_number: string }>(
    `UPDATE vlm_training_dataset
     SET excluded_from_training = true,
         excluded_reason = $1,
         excluded_at = NOW(),
         excluded_by = $2
     WHERE drop_number = $3
       AND excluded_from_training = false
     RETURNING drop_number`,
    [reason, excludedBy, dropNumber]
  );
  return rows.length > 0;
}
